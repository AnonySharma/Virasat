// Ambient type declarations for Virasat's cross-module globals.
//
// The app is a set of ordered classic <script> IIFEs (no bundler, no ESM),
// so every module talks to the others through `window.*` globals — e.g.
// tree-view.js calls FamilyStore, PhotoStore, UI, I18n without importing them.
// TypeScript's checker (run via `// @ts-check`, editor-only / CI-only — this
// file ships nothing and changes no runtime behaviour) can't see those
// cross-file assignments, so it flags every use as "Cannot find name".
//
// Declaring them here once, as ambient globals, silences that noise so the
// checker's real signal — null derefs, wrong argument counts/types, typos
// inside a file — comes through. They're typed `any` on purpose for this
// pilot: the goal of enabling @ts-check is intra-file correctness, not a
// fully-typed cross-module API surface. Tightening these to real shapes is a
// later, incremental step, one module at a time.
//
// The list mirrors the globals asserted by tests/smoke.mjs, plus `supabase`
// (the UMD SDK global, present only when cloud config is populated).

declare const I18n: any;
declare const FamilyStore: any;
declare const PhotoStore: any;
declare const UI: any;
declare const HeritagePicker: any;
declare const HeritageSelect: any;
declare const CropEditor: any;
declare const PathFinder: any;
declare const Inspector: any;
declare const PeopleView: any;
declare const TreeView: any;
declare const TimelineView: any;
declare const InsightsView: any;
declare const ProfileView: any;
declare const ImageExport: any;
declare const ExportImport: any;
declare const CollectForm: any;
declare const PrintBook: any;
declare const VirasatConfig: any;
declare const Auth: any;
declare const CloudStore: any;
declare const SignIn: any;
declare const FirstRun: any;
declare const TreeList: any;
declare const Sharing: any;
declare const SampleData: any;
declare const supabase: any;
// Not in the smoke.mjs global list: assigned late by app.js (window.Filter =
// { get, set }) and read back within the same file. Declared here so its use
// sites type-check like the other cross-module globals.
declare const Filter: any;

// The same names are also reached as members of `window` (e.g.
// `window.PhotoStore`, `window.I18n`) in guard expressions. Mirror them onto
// the Window type so both access styles type-check.
interface Window {
  I18n: any;
  FamilyStore: any;
  PhotoStore: any;
  UI: any;
  HeritagePicker: any;
  HeritageSelect: any;
  CropEditor: any;
  PathFinder: any;
  Inspector: any;
  PeopleView: any;
  TreeView: any;
  TimelineView: any;
  InsightsView: any;
  ProfileView: any;
  ImageExport: any;
  ExportImport: any;
  CollectForm: any;
  PrintBook: any;
  VirasatConfig: any;
  Auth: any;
  CloudStore: any;
  SignIn: any;
  FirstRun: any;
  TreeList: any;
  Sharing: any;
  SampleData: any;
  supabase: any;
  Filter: any;
}
