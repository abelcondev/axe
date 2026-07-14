/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  ReferenceService,
  buildSearchPattern,
  escapeRegExp,
  normalizeGitUrl,
} from './reference-service.js';
export { EMBEDDING_MODEL, provisionSemanticSearch } from './embeddings.js';
export type { ProvisionStep } from './embeddings.js';
export {
  clearStoredHfToken,
  getSemanticSearchStatus,
  getStoredHfToken,
  isValidHfToken,
  maskToken,
  setStoredHfToken,
} from './embedding-runtime.js';
export type { SemanticSearchStatus } from './embedding-runtime.js';
export type {
  ActivePackage,
  IReferenceService,
  ReferenceEntry,
  ReferenceManifest,
  ReferenceSearchOutcome,
  ReferenceSearchResult,
  ReferenceSource,
  ReferenceStatus,
} from './types.js';
