import { createApp } from "vue";
import App from "./App.vue";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { initTheme, syncFromServer } from "./theme.js";
import { syncPanelWidths } from "./panel-widths.js";
import { hydrateEditor } from "./editor.js";
import { hydrateMultilingualLocales } from "./multilingualLocales.js";

// Paint the cached/system theme synchronously (no flash), then reconcile with the
// machine-wide pref so a choice made on another port/instance carries over. Panel
// widths follow the same cache-then-reconcile pattern.
initTheme();
createApp(App).mount("#app");
void syncFromServer();
void syncPanelWidths();
// Pull the per-project editor preference (gitignored local settings) after mount.
void hydrateEditor();
// Same source: the multilingual view's remembered locale subset.
void hydrateMultilingualLocales();
