<script lang="ts">
  import { last } from "lodash";
  import { normalizePath } from "obsidian";
  import { draftForPath, projectFolderPath } from "src/model/scene-navigation";
  import { pluginSettings, projects } from "src/model/stores";
  import {
    drafts,
    selectedDraft,
    selectedDraftVaultPath,
  } from "src/model/stores";
  import { getContext, onMount } from "svelte";
  import Disclosure from "../components/Disclosure.svelte";
  import Icon from "../components/Icon.svelte";
  import { FileSuggest } from "../settings/file-suggest";
  import { FolderSuggest } from "../settings/folder-suggest";
  import {
    selectedDraftWordCountStatus,
    goalProgress,
    activeFile,
  } from "../stores";
  import DraftList from "./DraftList.svelte";
  import { useApp } from "../utils";

  const app = useApp();

  let showMetdata = true;
  let showWordCount = true;
  let showDrafts = true;

  function titleChanged(event: Event) {
    let newTitle = (event.target as any).value;
    drafts.update((_drafts) => {
      const currentDraftIndex = _drafts.findIndex(
        (d) => d.vaultPath === $selectedDraftVaultPath
      );
      if (currentDraftIndex >= 0) {
        const currentDraft = _drafts[currentDraftIndex];
        const currentTitle = currentDraft.title;
        let titleInFrontmatter = true;

        if (newTitle.length === 0) {
          newTitle = last(
            _drafts[currentDraftIndex].vaultPath.split("/")
          ).split(".md")[0];
          titleInFrontmatter = false;
        }

        return _drafts.map((d) => {
          if (d.title === currentTitle) {
            d.title = newTitle;
            d.titleInFrontmatter = titleInFrontmatter;
          }
          return d;
        });
      }
      return _drafts;
    });
  }

  let sceneFolderInput: HTMLInputElement;
  onMount(() => {
    if (sceneFolderInput && $selectedDraft.format === "scenes") {
      const projectPath = projectFolderPath($selectedDraft, app.vault);
      new FolderSuggest(app, sceneFolderInput, projectPath);
    }
  });

  async function sceneFolderChanged(event: Event) {
    const newFolder = (event.target as any).value;
    if (newFolder.length <= 0 || !$selectedDraft) {
      return;
    }
    const root = app.vault.getAbstractFileByPath($selectedDraft.vaultPath)
      .parent.path;
    const path = normalizePath(`${root}/${newFolder}`);
    const exists = await app.vault.adapter.exists(path);
    if (exists) {
      drafts.update((allDrafts) =>
        allDrafts.map((d) => {
          if (
            d.vaultPath === $selectedDraftVaultPath &&
            d.format === "scenes"
          ) {
            d.sceneFolder = newFolder;
          }
          return d;
        })
      );
    }
  }

  let sceneTemplateInput: HTMLInputElement;
  onMount(() => {
    if (sceneTemplateInput && $selectedDraft.format === "scenes") {
      new FileSuggest(app, sceneTemplateInput);
    }
  });
  async function sceneTemplateChanged(event: Event) {
    let newTemplate = (event.target as any).value;
    if (!$selectedDraft) {
      return;
    }
    let exists = true;
    if (newTemplate.length <= 0) {
      newTemplate = null;
    } else {
      exists = await app.vault.adapter.exists(newTemplate);
    }

    if (exists) {
      drafts.update((allDrafts) =>
        allDrafts.map((d) => {
          if (
            d.vaultPath === $selectedDraftVaultPath &&
            d.format === "scenes"
          ) {
            d.sceneTemplate = newTemplate;
          }
          return d;
        })
      );
    }
  }

  let projectCount: number;
  let draftCount: number | null;
  let sceneCount: number | null;
  $: {
    if ($selectedDraftWordCountStatus) {
      const { scene, draft, project } = $selectedDraftWordCountStatus;

      projectCount = project;
      draftCount = $projects[$selectedDraft.title].length > 1 ? draft : null;
      sceneCount = $selectedDraft.format === "scenes" ? scene : null;
    }
  }

  let showProgress = false;
  $: {
    if ($activeFile && $selectedDraft) {
      const draft = draftForPath($activeFile.path, $drafts);
      showProgress = draft && draft.vaultPath === $selectedDraft.vaultPath;
    }
  }

  let goalPercentage: number;
  let goalDescription: string;
  $: {
    goalPercentage = Math.ceil(Math.min($goalProgress, 1) * 100);
    goalDescription = `${Math.round(
      $goalProgress * $pluginSettings.sessionGoal
    )}/${$pluginSettings.sessionGoal}`;
  }

  function pluralize(
    count: number,
    noun: string,
    pluralNoun: string | null = null
  ) {
    if (count === undefined) {
      return "";
    }
    if (count === 1) {
      return `${count.toLocaleString()} ${noun}`;
    } else if (pluralNoun) {
      return `${count.toLocaleString()} ${pluralNoun}`;
    } else {
      return `${count.toLocaleString()} ${noun}s`;
    }
  }

  const showNewDraftModal: () => void = getContext("showNewDraftModal");
  function onNewDraft() {
    showNewDraftModal();
  }
</script>

<div>
  {#if $selectedDraft}
    <div class="longform-project-section">
      <div
        class="longform-project-details-section-header"
        on:click={() => {
          showMetdata = !showMetdata;
        }}
      >
        <Disclosure collapsed={!showMetdata} />
        <h4>Project Metadata</h4>
      </div>
      {#if showMetdata}
        <div>
          <label for="longform-project-title">Title</label>
          <input
            id="longform-project-title"
            type="text"
            value={$selectedDraft.title}
            on:change={titleChanged}
          />
          {#if $selectedDraft.format === "scenes"}
            <label for="longform-project-scene-folder">Scene Folder</label>
            <input
              id="longform-project-scene-folder"
              type="text"
              value={$selectedDraft.sceneFolder}
              bind:this={sceneFolderInput}
              on:blur={sceneFolderChanged}
            />
            <p class="longform-project-warning">
              Changing scene folder does not move scenes. If you’re moving
              scenes to a new folder, move them in your vault first, then
              change this setting.
            </p>
            <label for="longform-project-scene-template">Scene Template</label
            >
            <input
              id="longform-project-scene-template"
              type="text"
              value={$selectedDraft.sceneTemplate}
              bind:this={sceneTemplateInput}
              on:blur={sceneTemplateChanged}
            />
            <p class="longform-project-warning">
              This file will be used as a template when creating new scenes
              via the New Scene… field. If you use a templating plugin
              (Templater or the core plugin) it will be used to process this
              template.
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  <div
    class="longform-project-section word-counts"
    style={`--progress-text-color:${
      goalPercentage >= 43 ? "var(--text-on-accent)" : "var(--text-accent)"
    }`}
  >
    <div
      class="longform-project-details-section-header"
      on:click={() => {
        showWordCount = !showWordCount;
      }}
    >
      <Disclosure collapsed={!showWordCount} />
      <h4>Word Count</h4>
    </div>
    {#if showWordCount}
      <div>
        {#if showProgress}
          <div
            class="progress"
            data-label={goalDescription}
            title={goalDescription}
          >
            <div class="value" style={`width:${goalPercentage}%;`} />
          </div>
        {/if}
        {#if sceneCount}
          <p title="Word count in this scene of this project.">
            <strong>Scene:</strong>
            {pluralize(sceneCount, "word")}
          </p>
        {/if}
        {#if draftCount}
          <p title="Word count in just this draft of this project.">
            <strong>Draft:</strong>
            {pluralize(draftCount, "word")}
          </p>
        {/if}
        <p title="Word count across all drafts of this project.">
          <strong>Project:</strong>
          {pluralize(projectCount, "word")}
        </p>
      </div>
    {/if}
  </div>
  <div class="longform-project-section">
    <div class="drafts-title-container">
      <div
        class="longform-project-details-section-header"
        on:click={() => {
          showDrafts = !showDrafts;
        }}
      >
        <Disclosure collapsed={!showDrafts} />
        <h4>Drafts</h4>
      </div>
      <button type="button" on:click={onNewDraft}>
        <Icon iconName="plus-with-circle" />
      </button>
    </div>
    {#if showDrafts}
      <DraftList />
    {/if}
  </div>
</div>

<style>
  .longform-project-section {
    margin-top: var(--size-4-4);
    padding-bottom: var(--size-4-2);
    padding-left: var(--size-4-8);
  }

  .longform-project-section + .longform-project-section {
    border-top: var(--border-width) solid var(--background-modifier-border);
    padding-top: var(--size-4-4);
  }

  .longform-project-section .right-triangle {
    margin-left: var(--size-4-1);
    margin-right: var(--size-4-2);
  }

  .longform-project-details-section-header {
    display: flex;
    flex-direction: row;
    justify-content: start;
    align-items: center;
    cursor: pointer;
    margin-left: calc(var(--size-4-6) * -1);
  }

  h4 {
    font-size: var(--font-ui-medium);
    color: var(--text-normal);
    user-select: none;
    font-weight: inherit;
    margin: 0 0 0 var(--size-4-4);
  }

  input {
    width: 100%;
  }

  label {
    display: block;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    margin-top: var(--size-4-4);
    line-height: var(--line-height-tight);
  }

  p.longform-project-warning {
    color: var(--text-faint);
    font-size: var(--font-smallest);
    margin: var(--size-2-1) 0 0 var(--size-2-1);
    line-height: normal;
  }

  .word-counts p {
    margin: var(--size-4-2) 0;
    font-size: var(--font-smallest);
    color: var(--text-muted);
  }

  .word-counts p strong {
    color: var(--text-normal);
  }


  .progress {
    height: var(--size-4-6);
    width: 100%;
    background-color: var(--background-secondary-alt);
    border-radius: var(--radius-s);
    position: relative;
    overflow: hidden;
    margin-top: var(--size-4-4);
  }

  .progress:before {
    content: attr(data-label);
    font-size: var(--font-smallest);
    color: var(--progress-text-color);
    font-weight: bold;
    position: absolute;
    text-align: center;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    align-self: center;
    height: 100%;
  }

  .progress .value {
    height: 100%;
    background-color: var(--text-accent);
  }

  .drafts-title-container {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--size-4-2);
  }

  .drafts-title-container h4 {
    margin-right: var(--size-4-2);
  }

  .drafts-title-container button {
    margin: 0;
    padding: var(--size-4-2);
    color: var(--interactive-accent);
    background-color: inherit;
  }
</style>
