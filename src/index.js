// cropcompass: subject-aware cropping for photo layouts, with no dependencies in its core.
export { FOCUS_SIZE, focusFrom, focusOfImage, detailMap, cleanFocus } from './focus.js';
export { subjectsFrom, subjectsOfImage } from './subjects.js';
export { visible, lossOf, cropFor, centreCrop, cutOf, cutsOf, keptOf, subjectsOf, isTight, costOf, arrange, LEAN, HIGH, CHECK_CUT, CHECK_LOSS } from './crop.js';
// Optional face detection: nothing loads until loadFaceDetector() is called.
export { loadFaceDetector, facesToSubjects, combineSubjects, FACE_MODELS, FACE_RUNTIME } from './faces.js';
