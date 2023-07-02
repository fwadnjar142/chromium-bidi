/*
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import type {CommonDataTypes, Script} from '../../../protocol/protocol.js';
import {uuidv4} from '../../../utils/uuid.js';
import {ChannelProxy} from '../script/channelProxy.js';

import type {CdpTarget} from './cdpTarget.js';

type CdpPreloadScript = {
  /** CDP target. Includes session ID and target ID. */
  target: CdpTarget;
  /** CDP preload script ID. */
  preloadScriptId: Script.PreloadScript;
};

/**
 * BiDi IDs are generated by the server and are unique within the context.
 *
 * CDP preload script IDs are generated by the client and are unique
 * within the session.
 *
 * The mapping between BiDi and CDP preload script IDs is 1:many.
 * BiDi IDs are needed by the mapper to keep track of potential multiple CDP IDs
 * in the client.
 */
export class BidiPreloadScript {
  /** BiDi ID, an automatically generated UUID. */
  readonly #id: string = uuidv4();
  /** CDP preload scripts. */
  #cdpPreloadScripts: CdpPreloadScript[] = [];
  /** The script itself, in a format expected by the spec i.e. a function. */
  readonly #functionDeclaration: string;
  /** Browsing context ID. */
  readonly #contextId: CommonDataTypes.BrowsingContext | null;
  /** Targets, in which the preload script is initialized. */
  readonly #targetIds = new Set<string>();
  /** Channels to be added as arguments to functionDeclaration. */
  readonly #channels: ChannelProxy[];

  get id(): string {
    return this.#id;
  }

  get contextId(): CommonDataTypes.BrowsingContext | null {
    return this.#contextId;
  }

  get targetIds(): Set<string> {
    return this.#targetIds;
  }

  constructor(params: Script.AddPreloadScriptParameters) {
    if (params.sandbox !== undefined) {
      // TODO: Handle sandbox.
      throw new Error('Sandbox is not supported yet');
    }

    this.#channels =
      params.arguments?.map((a) => new ChannelProxy(a.value)) ?? [];
    this.#functionDeclaration = params.functionDeclaration;
    this.#contextId = params.context ?? null;
  }

  /** Channels of the preload script. */
  get channels(): ChannelProxy[] {
    return this.#channels;
  }

  /**
   * Adds the script to the given CDP targets by calling the
   * `Page.addScriptToEvaluateOnNewDocument` command.
   */
  async initInTargets(cdpTargets: Iterable<CdpTarget>) {
    await Promise.all(
      Array.from(cdpTargets).map((cdpTarget) => this.initInTarget(cdpTarget))
    );
  }

  /**
   * String to be evaluated. Wraps user-provided function so that the following
   * steps are run:
   * 1. Create channels.
   * 2. Store the created channels in window.
   * 3. Call the user-provided function with channels as arguments.
   */
  #getEvaluateString() {
    const channelsArgStr = `[${this.channels
      .map((c) => c.getEvalInWindowStr())
      .join(', ')}]`;

    return `(()=>{(${this.#functionDeclaration})(...${channelsArgStr})})()`;
  }

  /**
   * Adds the script to the given CDP target by calling the
   * `Page.addScriptToEvaluateOnNewDocument` command.
   */
  async initInTarget(cdpTarget: CdpTarget) {
    const addCdpPreloadScriptResult = await cdpTarget.cdpClient.sendCommand(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: this.#getEvaluateString(),
      }
    );

    this.#cdpPreloadScripts.push({
      target: cdpTarget,
      preloadScriptId: addCdpPreloadScriptResult.identifier,
    });
    this.#targetIds.add(cdpTarget.targetId);
  }

  /**
   * Schedules the script to be run right after
   * `Runtime.runIfWaitingForDebugger`, but does not wait for result.
   */
  scheduleEvaluateInTarget(cdpTarget: CdpTarget) {
    void cdpTarget.cdpClient.sendCommand('Runtime.evaluate', {
      expression: this.#getEvaluateString(),
    });
  }

  /**
   * Removes this script from all CDP targets.
   */
  async remove() {
    for (const cdpPreloadScript of this.#cdpPreloadScripts) {
      const cdpTarget = cdpPreloadScript.target;
      const cdpPreloadScriptId = cdpPreloadScript.preloadScriptId;
      await cdpTarget.cdpClient.sendCommand(
        'Page.removeScriptToEvaluateOnNewDocument',
        {
          identifier: cdpPreloadScriptId,
        }
      );
    }
  }

  /**
   * Removes the provided cdp target from the list of cdp preload scripts.
   */
  cdpTargetIsGone(cdpTargetId: string) {
    this.#cdpPreloadScripts = this.#cdpPreloadScripts.filter(
      (cdpPreloadScript) => cdpPreloadScript.target?.targetId !== cdpTargetId
    );
    this.#targetIds.delete(cdpTargetId);
  }
}