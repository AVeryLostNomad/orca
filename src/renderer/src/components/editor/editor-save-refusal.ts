/** Only overwrite grants disk-conflict consent; convert grants non-UTF-8 conversion consent. Other explicit saves remain guarded. */
export type EditorSaveTrigger = 'autosave' | 'user' | 'convert' | 'restart' | 'overwrite'

export const EDITOR_STALE_SAVE_MESSAGE =
  'This file changed on disk since your edits. Use the banner to compare, reload, or overwrite.'

export const EDITOR_NOT_UTF8_SAVE_MESSAGE = "This file isn't UTF-8 text, so it wasn't saved."
