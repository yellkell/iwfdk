/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export const DEFAULT_PROFILES_PATH =
  'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles';

import type {
  VisualConstructor,
  VisualImplementation,
} from '../visual/adapter/base-visual-adapter.js';
import {
  PROFILES_LIST,
  getProfile as getGeneratedProfile,
} from './generated-profiles.js';
import { VALVE_FRAME_PROFILE } from './profiles/valve-frame.js';
const DEFAULT_PROFILE = 'generic-trigger';
const PROFILE_LIST_NAME = 'profilesList.json';

type ComponentState = 'default' | 'touched' | 'pressed';
type ValueNodeProperty = 'transform' | 'visibility';
type GamepadIndexKeys = 'button' | 'xAxis' | 'yAxis';

export interface InputComponentConfig {
  type: 'trigger' | 'squeeze' | 'thumbstick' | 'touchpad' | 'button';
  gamepadIndices: Partial<{ [id in GamepadIndexKeys]: number }>;
  rootNodeName: string;
  touchPointNodeName?: string;
  visualResponses: {
    [id: string]: {
      componentProperty: 'button' | 'xAxis' | 'yAxis' | 'state';
      states: ComponentState[];
      valueNodeProperty: ValueNodeProperty;
      valueNodeName: string;
      minNodeName?: string;
      maxNodeName?: string;
    };
  };
}

export interface InputLayout {
  selectComponentId: string;
  components: { [id: string]: InputComponentConfig };
  rootNodeName: string;
  gamepadMapping: 'xr-standard' | '';
  assetPath: string;
}

export interface InputProfile {
  profileId: string;
  fallbackProfileIds: string[];
  layouts: Partial<{ [handedness in XRHandedness]: InputLayout }>;
}

export interface RegisterInputProfileOptions {
  /**
   * Base URL that relative layout `assetPath`s resolve against. Defaults to
   * `<DEFAULT_PROFILES_PATH>/<profileId>`. Absolute asset paths are used as is.
   */
  assetBasePath?: string;
  /**
   * Visual used for controllers that resolve to this profile, instead of the
   * adapter's default (`AnimatedController`). An app's explicit
   * `updateVisualImplementation()` call still takes precedence.
   */
  visualClass?: VisualConstructor<VisualImplementation>;
}

type RegisteredInputProfile = {
  profile: InputProfile;
  assetBasePath?: string;
  visualClass?: VisualConstructor<VisualImplementation>;
};

const registeredProfiles = new Map<string, RegisteredInputProfile>();

/**
 * Make an input profile that is not in the bundled
 * `@webxr-input-profiles/assets` set resolvable, or override a bundled one.
 * Registered profiles are matched before bundled ones for the same profile id;
 * an input source's `profiles` array is still walked in order.
 */
export function registerInputProfile(
  profile: InputProfile,
  options: RegisterInputProfileOptions = {},
): void {
  registeredProfiles.set(profile.profileId, {
    profile,
    assetBasePath: options.assetBasePath,
    visualClass: options.visualClass,
  });
}

export function unregisterInputProfile(profileId: string): boolean {
  return registeredProfiles.delete(profileId);
}

export function getRegisteredInputProfile(
  profileId: string,
): InputProfile | undefined {
  return registeredProfiles.get(profileId)?.profile;
}

// Profiles IWFDK ships beyond the generated registry snapshot.
registerInputProfile(VALVE_FRAME_PROFILE);

function isAbsoluteAssetPath(assetPath: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(assetPath) || assetPath.startsWith('/');
}

function resolveAssetPath(
  profileId: string,
  assetPath: string,
  assetBasePath?: string,
): string {
  if (isAbsoluteAssetPath(assetPath)) {
    return assetPath;
  }
  const base = assetBasePath ?? `${DEFAULT_PROFILES_PATH}/${profileId}`;
  return `${base.replace(/\/+$/, '')}/${assetPath}`;
}

type ResolvedProfile = RegisteredInputProfile;

function resolveProfileSync(
  inputSource: XRInputSource,
  defaultProfile: string,
): ResolvedProfile {
  for (const profileId of [...inputSource.profiles, defaultProfile]) {
    const registered = registeredProfiles.get(profileId);
    if (registered) {
      return registered;
    }
    const supportedProfile = PROFILES_LIST[profileId];
    if (supportedProfile) {
      return { profile: getGeneratedProfile(supportedProfile.path) };
    }
  }
  throw new Error(
    `No matching profile name found and default profile "${defaultProfile}" missing.`,
  );
}

export async function fetchJsonFile(path: string): Promise<InputProfile> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(response.statusText);
  } else {
    return response.json();
  }
}

export async function fetchProfilesList(
  basePath: string = DEFAULT_PROFILES_PATH,
): Promise<any> {
  const profilesList = await fetchJsonFile(`${basePath}/${PROFILE_LIST_NAME}`);
  return profilesList;
}

type FetchProfileOptions = {
  basePath?: string;
  defaultProfile?: string;
  getAssetPath?: boolean;
};

export function fetchProfileSync(
  inputSource: XRInputSource,
  {
    defaultProfile = DEFAULT_PROFILE,
  }: Omit<FetchProfileOptions, 'basePath'> = {},
): InputProfile {
  return resolveProfileSync(inputSource, defaultProfile).profile;
}

export async function fetchProfile(
  inputSource: XRInputSource,
  {
    basePath = DEFAULT_PROFILES_PATH,
    defaultProfile = DEFAULT_PROFILE,
  }: FetchProfileOptions,
): Promise<InputProfile> {
  const candidates = [...inputSource.profiles, defaultProfile];
  const firstRegistered = candidates.findIndex((id) =>
    registeredProfiles.has(id),
  );
  // Nothing earlier than a registered profile can match without the list.
  if (firstRegistered === 0) {
    return registeredProfiles.get(candidates[0])!.profile;
  }

  const supportedProfilesList = await fetchProfilesList(basePath);
  for (const profileId of candidates) {
    const registered = registeredProfiles.get(profileId);
    if (registered) {
      return registered.profile;
    }
    const supportedProfile = supportedProfilesList[profileId];
    if (supportedProfile) {
      return fetchJsonFile(`${basePath}/${supportedProfile.path}`);
    }
  }
  throw new Error(
    `No matching profile name found and default profile "${defaultProfile}" missing.`,
  );
}

export function loadInputProfile(inputSource: XRInputSource) {
  const profileId = inputSource.profiles[0];
  const { profile, assetBasePath, visualClass } = resolveProfileSync(
    inputSource,
    DEFAULT_PROFILE,
  );
  const layout = profile.layouts[inputSource.handedness];
  if (!layout) {
    throw new DOMException('No applicable layout found', 'NotSupportedError');
  }
  return {
    inputSource,
    layout,
    profileId,
    resolvedProfileId: profile.profileId,
    assetPath: resolveAssetPath(
      profile.profileId,
      layout.assetPath,
      assetBasePath,
    ),
    visualClass,
  };
}
