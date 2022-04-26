import { Plugin, WorkspaceLeaf, FileView, addIcon } from "obsidian";
import debounce from "lodash/debounce";
import pick from "lodash/pick";
import type { Unsubscriber } from "svelte/store";
import { get } from "svelte/store";
import {
  VIEW_TYPE_LONGFORM_EXPLORER,
  ExplorerPane,
} from "./view/explorer/ExplorerPane";
import type {
  Draft,
  LongformPluginSettings,
  SerializedWorkflow,
} from "./model/types";
import { DEFAULT_SETTINGS, TRACKED_SETTINGS_PATHS } from "./model/types";
import { activeFile } from "./view/stores";
import { ICON_NAME, ICON_SVG } from "./view/icon";
import { LongformSettingsTab } from "./view/settings/LongformSettings";
import {
  deserializeWorkflow,
  serializeWorkflow,
} from "./compile/serialization";
import type { Workflow } from "./compile";
import { DEFAULT_WORKFLOWS } from "./compile";
import { UserScriptObserver } from "./model/user-script-observer";
import { StoreVaultSync } from "./model/store-vault-sync";
import {
  selectedDraft,
  selectedDraftVaultPath,
  workflows,
  initialized,
  pluginSettings,
  drafts,
} from "./model/stores";
import { addCommands } from "./commands";
import { determineMigrationStatus } from "./model/migration";
import { draftForPath } from "./model/scene-navigation";

const LONGFORM_LEAF_CLASS = "longform-leaf";

// TODO: Try and abstract away more logic from actual plugin hooks here

export default class LongformPlugin extends Plugin {
  // Local mirror of the pluginSettings store
  // since this class does a lot of ad-hoc settings fetching.
  // More efficient than a lot of get() calls.
  cachedSettings: LongformPluginSettings | null = null;
  private unsubscribeSettings: Unsubscriber;
  private unsubscribeWorkflows: Unsubscriber;
  private unsubscribeDrafts: Unsubscriber;
  private unsubscribeSelectedDraft: Unsubscriber;
  private userScriptObserver: UserScriptObserver;

  private storeVaultSync: StoreVaultSync;

  async onload(): Promise<void> {
    console.log(`[Longform] Starting Longform ${this.manifest.version}…`);
    addIcon(ICON_NAME, ICON_SVG);

    this.registerView(
      VIEW_TYPE_LONGFORM_EXPLORER,
      (leaf: WorkspaceLeaf) => new ExplorerPane(leaf)
    );

    // Settings
    this.unsubscribeSettings = pluginSettings.subscribe(async (value) => {
      let shouldSave = false;
      if (
        this.cachedSettings &&
        this.cachedSettings.userScriptFolder !== value.userScriptFolder
      ) {
        shouldSave = true;
      }

      this.cachedSettings = value;

      if (shouldSave) {
        await this.saveSettings();
      }
    });

    await this.loadSettings();
    this.addSettingTab(new LongformSettingsTab(this.app, this));

    this.storeVaultSync = new StoreVaultSync(this.app);

    this.app.workspace.onLayoutReady(this.postLayoutInit.bind(this));

    // Track active file
    activeFile.set(this.app.workspace.getActiveFile());
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf.view instanceof FileView) {
          activeFile.set(leaf.view.file);
        }
      })
    );

    addCommands(this);

    // Dynamically style longform scenes
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.styleLongformLeaves();
      })
    );
    this.unsubscribeDrafts = drafts.subscribe((allDrafts) => {
      this.styleLongformLeaves(allDrafts);
    });
  }

  onunload(): void {
    this.userScriptObserver.destroy();
    this.storeVaultSync.destroy();
    this.unsubscribeSettings();
    this.unsubscribeWorkflows();
    this.unsubscribeSelectedDraft();
    this.unsubscribeDrafts();
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_LONGFORM_EXPLORER)
      .forEach((leaf) => leaf.detach());
  }

  async loadSettings(): Promise<void> {
    const settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    const _pluginSettings: LongformPluginSettings = pick(
      settings,
      TRACKED_SETTINGS_PATHS
    ) as LongformPluginSettings;
    pluginSettings.set(_pluginSettings);
    selectedDraftVaultPath.set(_pluginSettings.selectedDraftVaultPath);
    determineMigrationStatus(_pluginSettings);

    // We load user scripts imperatively first to cover cases where we need to deserialize
    // workflows that may contain them.
    const userScriptFolder = settings["userScriptFolder"];
    this.userScriptObserver = new UserScriptObserver(
      this.app.vault,
      userScriptFolder
    );
    await this.userScriptObserver.loadUserSteps();

    let _workflows = settings["workflows"];

    if (!_workflows) {
      console.log("[Longform] No workflows found; adding default workflow.");
      _workflows = DEFAULT_WORKFLOWS;
    }

    const deserializedWorkflows: Record<string, Workflow> = {};
    Object.entries(_workflows).forEach(([key, value]) => {
      deserializedWorkflows[key as string] = deserializeWorkflow(value);
    });
    workflows.set(deserializedWorkflows);
  }

  async saveSettings(): Promise<void> {
    if (!this.cachedSettings) {
      return;
    }

    const _workflows = get(workflows);
    const serializedWorkflows: Record<string, SerializedWorkflow> = {};
    Object.entries(_workflows).forEach(([key, value]) => {
      serializedWorkflows[key as string] = serializeWorkflow(value);
    });

    await this.saveData({
      ...this.cachedSettings,
      workflows: serializedWorkflows,
    });
  }

  private postLayoutInit(): void {
    this.userScriptObserver.beginObserving();
    this.watchProjects();

    this.unsubscribeSelectedDraft = selectedDraft.subscribe(async (d) => {
      if (!get(initialized) || !d) {
        return;
      }
      pluginSettings.update((s) => ({
        ...s,
        selectedDraftVaultPath: d.vaultPath,
      }));
      this.cachedSettings = get(pluginSettings);
      await this.saveSettings();
    });

    // Workflows
    const saveWorkflows = debounce(() => {
      this.saveSettings();
    }, 3000);
    this.unsubscribeWorkflows = workflows.subscribe(() => {
      if (!get(initialized)) {
        return;
      }

      saveWorkflows();
    });

    this.initLeaf();
    initialized.set(true);
  }

  initLeaf(): void {
    if (
      this.app.workspace.getLeavesOfType(VIEW_TYPE_LONGFORM_EXPLORER).length
    ) {
      return;
    }
    this.app.workspace.getLeftLeaf(false).setViewState({
      type: VIEW_TYPE_LONGFORM_EXPLORER,
    });
  }

  private watchProjects(): void {
    this.registerEvent(
      this.app.vault.on(
        "modify",
        this.userScriptObserver.fileEventCallback.bind(this.userScriptObserver)
      )
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.userScriptObserver.fileEventCallback.bind(this.userScriptObserver)(
          file
        );
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.userScriptObserver.fileEventCallback.bind(this.userScriptObserver)(
          file
        );
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, _oldPath) => {
        this.userScriptObserver.fileEventCallback.bind(this.userScriptObserver)(
          file
        );
      })
    );

    this.storeVaultSync.discoverDrafts();

    this.registerEvent(
      this.app.metadataCache.on(
        "changed",
        this.storeVaultSync.fileMetadataChanged.bind(this.storeVaultSync)
      )
    );

    this.registerEvent(
      this.app.vault.on(
        "delete",
        this.storeVaultSync.fileDeleted.bind(this.storeVaultSync)
      )
    );

    this.registerEvent(
      this.app.vault.on(
        "rename",
        this.storeVaultSync.fileRenamed.bind(this.storeVaultSync)
      )
    );
  }

  private styleLongformLeaves(allDrafts: Draft[] = get(drafts)) {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      if (leaf.view instanceof FileView) {
        const draft = draftForPath(
          leaf.view.file.path,
          allDrafts,
          this.app.vault
        );
        if (draft) {
          leaf.view.containerEl.classList.add(LONGFORM_LEAF_CLASS);
        } else {
          leaf.view.containerEl.classList.remove(LONGFORM_LEAF_CLASS);
        }
      }

      // @ts-ignore
      const leafId = leaf.id;
      if (leafId) {
        leaf.view.containerEl.dataset.leafId = leafId;
      }
    });
  }
}
