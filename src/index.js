// cropcompass: subject-aware cropping for photo layouts, with no dependencies in its core.
export { FOCUS_SIZE, focusFrom, focusOfImage, detailMap, cleanFocus } from './focus.js';
export { subjectsFrom, subjectsOfImage } from './subjects.js';
export { visible, lossOf, cropFor, centreCrop, cutOf, cutsOf, keptOf, subjectsOf, isTight, costOf, arrange, LEAN, HIGH, CHECK_CUT, CHECK_LOSS } from './crop.js';
// Optional people-and-things detection: nothing loads until loadSubjectDetector() is called.
export { loadSubjectDetector, detectionsToSubjects, combineSubjects, KINDS, MIN_SCORE, DETECT_MODEL, DETECT_RUNTIME } from './detect.js';
