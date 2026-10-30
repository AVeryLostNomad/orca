export type BrowserLinkOpeningSettings = {
  /** Links from Orca surfaces join the browser without taking focus from the pane they came from. */
  openLinksInAppInBackground?: boolean
  /** Opt-in: with no browser visible, links open in a split beside the source pane instead of a tab in it. */
  openLinksInAppBesideSource?: boolean
}
