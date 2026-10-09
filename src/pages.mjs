import { site } from '../site.config.mjs';
import languageCatalog from './languages.json' with { type: 'json' };
const languageCount = languageCatalog.languages.length;
const escapeText = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const supportedLanguages = `<section id="languages" class="section wrap"><div class="section-heading"><h2>${languageCount} languages.<br>One listening experience.</h2><p>Choose any language documented for Gemini Live Translation, including Chinese Simplified and Traditional, and Portuguese for Brazil and Portugal.</p></div><details class="language-catalog"><summary>See all ${languageCount} supported languages</summary><ul class="supported-languages">${languageCatalog.languages.map((language) => '<li>' + escapeText(language.name) + '</li>').join('')}</ul></details><p class="small-copy">Based on <a href="${languageCatalog.source}" target="_blank" rel="noopener noreferrer">Google’s Live Translation language list</a>, checked October 3, 2026. Availability follows the supported model; quality varies by language and source. This is provider-documented support, not a listening benchmark in every language.</p></section>`;

const url = (route = '') => site.base + route;
const ext = 'target="_blank" rel="noopener noreferrer"';
const mail = `<a href="mailto:${site.email}">${site.email}</a>`;
const svg = {
  arrowUpRight: `<svg class="icon-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>`,
  arrowDown: `<svg class="icon-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>`,
  stream: `<svg class="icon-feature" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`,
  lock: `<svg class="icon-feature" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  controls: `<svg class="icon-feature" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`,
  clock: `<svg class="icon-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  volume: `<svg class="icon-card" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  captions: `<svg class="icon-card" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h3M14 15h3M7 11h10"/></svg>`,
  sliders: `<svg class="icon-card" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
};
const faq = (question, answer) =>
  `<details><summary>${question}</summary><div>${answer}</div></details>`;
const sectionHeading = (title, text = '') =>
  `<div class="section-heading"><h2>${title}</h2>${text ? `<p>${text}</p>` : ''}</div>`;
const pageIntro = (title, text) =>
  `<div class="wrap page-intro"><h1>${title}</h1><p class="intro-copy">${text}</p></div>`;
const storeButton = (store, label) =>
  site.stores[store]
    ? `<a class="button store" href="${site.stores[store]}" ${ext}>Install for ${label} ${svg.arrowUpRight}</a>`
    : `<div class="store-pending"><span>${label}</span><span class="pending-label">Coming soon</span></div>`;
const home = `
<section class="hero wrap">
  <div class="hero-copy">
    <div class="hero-badge"><span class="status-dot"></span><span>AI Dubbing &amp; Captions</span></div>
    <h1>A new language.<br>The same <em>curiosity.</em></h1>
    <p class="hero-description">Hear web audio in all ${languageCount} Gemini Live Translation languages. Follow along with bilingual captions, and keep the original sound within reach.</p>
    <div class="hero-actions">
      ${storeButton('chrome', 'Chrome')}
      <a class="button" href="${url('guide/')}">Explore the setup ${svg.arrowUpRight}</a>
      <a class="text-link" href="#how-it-works">See how it works ${svg.arrowDown}</a>
    </div>
    <p class="hero-note">Available for desktop Chrome. The Edge Add-ons listing is coming soon.<br>A Gemini API key is required. Google API fees may apply.</p>
  </div>
  <div class="hero-stage">
    <div class="stage-frame">
      <div class="stage-header">
        <span class="stage-dots"><i></i><i></i><i></i></span>
        <div class="stage-tab">
          <span class="tab-title">World Science Keynote · Speech Neuroscience</span>
        </div>
        <span class="stage-live"><span class="pulse-dot"></span> Live translation</span>
      </div>
      <div class="stage-player">
        <div class="player-visual">
          <div class="video-meta">
            <span class="meta-channel">Global Keynote 2026</span>
            <span class="meta-tag">Streaming video</span>
          </div>
          <div class="video-subtitles">
            <span class="sub-orig">"Sound carries emotion, while words structure understanding."</span>
            <span class="sub-dub">"Âm thanh truyền tải cảm xúc, còn ngôn từ xây dựng sự thấu hiểu."</span>
          </div>
        </div>
        <div class="extension-hud">
          <div class="hud-top">
            <div class="hud-brand"><img src="${url('assets/icon.svg')}" width="20" height="20" alt=""><strong>Audivoya</strong></div>
            <span class="hud-badge">Ready</span>
          </div>
          <div class="hud-target">
            <span class="hud-lang-label">Listen in</span>
            <div class="hud-lang-val"><span>Tiếng Việt (Vietnamese)</span><span class="hud-caret">▾</span></div>
          </div>
          <div class="hud-mixer">
            <div class="hud-slider-row">
              <span>Original audio</span>
              <div class="hud-bar"><div class="hud-fill" style="width: 25%"></div></div>
              <span>25%</span>
            </div>
            <div class="hud-slider-row active">
              <span>Dubbed voice</span>
              <div class="hud-bar"><div class="hud-fill active" style="width: 85%"></div></div>
              <span>85%</span>
            </div>
          </div>
          <div class="hud-action">
            <div class="hud-btn">Start dubbing →</div>
          </div>
        </div>
      </div>
      <div class="stage-footer">
        <span>Dual volume tracks</span>
        <span class="sep">·</span>
        <span>Synchronized bilingual captions</span>
        <span class="sep">·</span>
        <span>Gemini Live API</span>
      </div>
    </div>
  </div>
</section>
<div class="language-strip">
  <div class="wrap">
    <span>Made for everyday listening</span>
    <strong>Learn something new</strong>
    <span class="strip-bullet" aria-hidden="true">·</span>
    <strong>Follow a conversation</strong>
    <span class="strip-bullet" aria-hidden="true">·</span>
    <strong>Explore another perspective</strong>
  </div>
</div>
<section id="features" class="section wrap">
  ${sectionHeading('Make the audio<br>work for you.', 'Choose how you listen, read and stay in control.')}
  <div class="feature-grid">
    <article class="feature-card">
      <div class="feature-head">
        <span class="feature-icon" aria-hidden="true">${svg.volume}</span>
        <h3>Hear it in your language.</h3>
      </div>
      <p>Translate selected-tab audio into any of the ${languageCount} documented Gemini Live Translation languages through your Gemini API account.</p>
      <div class="feature-demo">
        <div class="lang-strip-preview">
          <span class="chip-item">English</span>
          <span class="chip-arrow">→</span>
          <span class="chip-item active">Tiếng Việt</span>
          <span class="chip-item">Español</span>
          <span class="chip-item">+75</span>
        </div>
      </div>
    </article>
    <article class="feature-card">
      <div class="feature-head">
        <span class="feature-icon" aria-hidden="true">${svg.captions}</span>
        <h3>Keep both sides of the story.</h3>
      </div>
      <p>View original and translated captions. Export VTT when you want a copy; timestamps follow caption arrival.</p>
      <div class="feature-demo">
        <div class="captions-demo">
          <div class="cap-line source">Follow the original speech in real time.</div>
          <div class="cap-line translated">Đồng thời theo dõi phụ đề bản dịch trực tiếp.</div>
        </div>
      </div>
    </article>
    <article class="feature-card">
      <div class="feature-head">
        <span class="feature-icon" aria-hidden="true">${svg.sliders}</span>
        <h3>Find your listening balance.</h3>
      </div>
      <p>Adjust each volume, follow the main player's speed, pick how long a session may run, or use Audio monitor to listen locally without AI uploads.</p>
      <div class="feature-demo">
        <div class="mixer-demo">
          <div class="mixer-line"><span>Original</span><div class="track"><div class="fill" style="width: 25%"></div></div><span>25%</span></div>
          <div class="mixer-line active"><span>Dubbed</span><div class="track"><div class="fill active" style="width: 85%"></div></div><span>85%</span></div>
        </div>
      </div>
    </article>
  </div>
</section>
${supportedLanguages}
<section id="how-it-works" class="section how-section">
  <div class="wrap how-grid">
    <div>
      ${sectionHeading('Your tab.<br>Your language.<br>Your call.', 'Start a session when you choose. Move between videos on the same website while the control panel is closed.')}
      <a class="text-link" href="${url('guide/')}">Open the illustrated guide ${svg.arrowUpRight}</a>
    </div>
    <ol class="steps">
      <li>
        <span class="step-num">1</span>
        <div>
          <h3>Open the media you want to understand.</h3>
          <p>Use a supported website in desktop Chrome or Edge, with media you have permission to process.</p>
        </div>
      </li>
      <li>
        <span class="step-num">2</span>
        <div>
          <h3>Choose a language and connect Gemini.</h3>
          <p>Enter your key in the extension. Review Google's audio-sharing notice, fees and account terms.</p>
        </div>
      </li>
      <li>
        <span class="step-num">3</span>
        <div>
          <h3>Press Start. Adjust as you listen.</h3>
          <p>Choose Start dubbing, or Start with sync window for a delayed picture. Control volumes and captions. Stop anytime from the panel or with <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>.</p>
        </div>
      </li>
    </ol>
  </div>
</section>
<section class="section wrap sync-section">
  <figure class="sync-diagram">
    <img class="sync-shot" src="${url('assets/guide/extension-sync.png')}" width="1280" height="900" loading="lazy" alt="Actual Audivoya sync window showing a locally buffered picture of a generated demo clip above a collapsed Controls panel">
    <figcaption class="shot-caption">Actual sync window · owned generated demo clip</figcaption>
    <div class="delay-chip">${svg.clock}<span>Adjustable picture delay</span></div>
  </figure>
  <div>
    ${sectionHeading('A little delay.<br>A better chance to align.', 'Start with sync window opens an experimental viewer that buffers the picture on your device while translation continues. Adjust the delay to improve the viewing experience.')}
    <p class="muted">It adds a viewing delay; it does not speed up AI inference. Translation timing and accuracy vary, and exact word alignment is not guaranteed.</p>
    <a class="text-link" href="${url('guide/#sync')}">Learn about synchronized viewing ${svg.arrowUpRight}</a>
  </div>
</section>
<section class="section privacy-section">
  <div class="wrap privacy-grid">
    <div>
      ${sectionHeading('Know what leaves<br>your browser.', 'Dubbing sends selected-tab audio directly to Google. Your provider account determines its fees and data-use terms.')}
      <a class="text-link" href="${url('privacy/')}">Read the privacy policy ${svg.arrowUpRight}</a>
    </div>
    <div class="privacy-points">
      <article>
        <div class="point-icon">${svg.stream}</div>
        <div>
          <h3>Audio goes directly to the provider.</h3>
          <p>No developer-operated audio server. Google processes dubbing requests under its own terms.</p>
        </div>
      </article>
      <article>
        <div class="point-icon">${svg.lock}</div>
        <div>
          <h3>Enter your key once, in the extension.</h3>
          <p>The latest candidate encrypts it in this browser profile and restores it automatically. No extra app, password or cloud sync. Forget key removes the saved record.</p>
        </div>
      </article>
      <article>
        <div class="point-icon">${svg.controls}</div>
        <div>
          <h3>You decide when capture starts and stops.</h3>
          <p>No automatic audio capture. No developer analytics or advertising. Optional sync pictures stay on your device.</p>
        </div>
      </article>
    </div>
  </div>
</section>
<section class="section wrap faq-section">
  ${sectionHeading('Before you press play.', 'Common questions about requirements, delay, and usage.')}
  <div class="faq">
    ${faq('Can I install it from the stores today?', `<p>Yes. <a href="${site.stores.chrome}" ${ext}>Audivoya is available in the Chrome Web Store</a> for desktop Chrome. The Edge Add-ons listing is still coming soon.</p>`)}
    ${faq('Do I need a Gemini API key?', `<p>Yes, for dubbing. The extension uses your Gemini API account. Google API charges, quotas, regional access and data-use terms apply. Audio monitor works locally without a provider key.</p><p><a href="${url('guide/#get-key')}">See the key setup guide</a></p>`)}
    ${faq('Does it translate instantly?', '<p>No. Translation needs processing time and enough speech context. Delay depends on your connection, content, model and playback speed. The optional sync window delays the picture to improve presentation alignment.</p>')}
    ${faq('Which browsers and languages are supported?', `<p>The current release is available for desktop Chrome. The Edge Add-ons listing is being prepared. All ${languageCount} languages documented for Gemini Live Translation are supported by the Chrome release. See the <a href="${url('#languages')}">full language list</a>. Live dubbing on Firefox, Safari and mobile is not available. Website and protected-media compatibility varies.</p>`)}
    ${faq('Will it keep up with faster video?', '<p>Dubbed audio follows the main observable HTML player within 0.25×–4×. Some embedded or custom players do not expose their speed. Faster playback does not accelerate Gemini inference and can reduce translation quality.</p>')}
    ${faq('Can I leave it running for hours?', '<p>Yes. Under Audio &amp; settings, <strong>Stop automatically after</strong> offers 5, 15, 30 and 60 minutes, 2, 3, 4 and 8 hours, or Never. The default is 60 minutes. With Never, capture and audio sent to Google continue, and Google API fees may accrue, until you press Stop, close the tab or leave the website.</p>')}
  </div>
</section>
<section id="install" class="wrap final-cta">
  <div>
    <h2>Bring a new language<br>to your browser.</h2>
    <p>Install the Chrome release today. The Edge listing is coming soon.</p>
  </div>
  <div class="install-actions">
    ${storeButton('chrome', 'Google Chrome')}
    ${storeButton('edge', 'Microsoft Edge')}
    <a class="text-link" href="${url('guide/')}">Get ready with the setup guide ${svg.arrowUpRight}</a>
  </div>
</section>`;

const guide = `${pageIntro('From your first key<br>to your first listen.', 'Install Audivoya ' + site.extensionVersion + ' from the Chrome Web Store. The Edge Add-ons listing is not available yet.')}<div class="wrap guide-layout"><aside class="guide-nav"><p class="nav-title">On this page</p><a href="#install">1. Install the extension</a><a href="#get-key">2. Get a Gemini key</a><a href="#start">3. Start dubbing</a><a href="#controls">4. Adjust your session</a><a href="#sync">5. Optional sync window</a><a href="#troubleshooting">Troubleshooting</a></aside><div class="guide-content">
<section id="install" class="guide-step"><span class="step-label">Step 1 · Install</span><h2>Install from the Chrome Web Store.</h2><p>Audivoya ${site.extensionVersion} is available for desktop Chrome. <a href="${site.stores.chrome}" ${ext}>Open Audivoya in the Chrome Web Store</a>, then select <strong>Add to Chrome</strong>. This website does not distribute extension files.</p>${storeButton('chrome', 'Google Chrome')}<div class="notice"><strong>Using Microsoft Edge?</strong><p>The Edge Add-ons release is still being prepared. Its official install link will appear here after publication. Avoid unofficial installers.</p></div><p>After installing in Chrome, open the Extensions menu and pin Audivoya for easy access. Open the media tab before opening the extension.</p><div id="edge-setup" class="notice"><strong>Using an existing Edge installation?</strong><p>Open Edge's Extensions menu and show Audivoya in the toolbar. If Edge asks for Google API access after Start dubbing, allow the displayed Google origin to enable translation. Audio monitor needs no Gemini key and keeps audio on your device.</p><p>To update or remove the extension, open Extensions → Manage extensions. Version ${site.extensionVersion} restores your encrypted key after restarting the browser or reloading Audivoya. Earlier 0.2.10 builds use temporary session storage and require re-entry after restart.</p></div></section>
<section id="get-key" class="guide-step"><span class="step-label">Step 2 · Connect provider</span><h2>Get a Gemini API key.</h2><p>Gemini access depends on your account, age, country, available models and quota. Check <a href="https://ai.google.dev/gemini-api/terms" ${ext}>Google's API terms</a> and <a href="https://ai.google.dev/gemini-api/docs/pricing" ${ext}>current pricing</a> first.</p><ol class="instruction-list"><li>Open <a href="https://aistudio.google.com/api-keys" ${ext}>Google AI Studio → API keys</a> and sign in to your Google account.</li><li>If your existing Cloud project is missing, open the dashboard's <strong>Projects</strong> page, choose <strong>Import projects</strong>, select your project and import it.</li><li>Return to <strong>API Keys</strong>. Choose <strong>Create API key</strong> and select an eligible project. Google may provide a default project for a new account.</li><li>Copy the newly created key privately. Paste it into the <strong>Gemini API key</strong> field inside the extension, never into this website.</li></ol><p class="small-copy">Button names and account access can change. Follow <a href="https://ai.google.dev/gemini-api/docs/api-key" ${ext}>Google's current key instructions</a> if your dashboard differs.</p><figure class="guide-image docs-image"><img src="${url('assets/guide/google-key-docs.png')}" width="1200" height="820" loading="lazy" alt="Screenshot of Google's public Gemini API key documentation with the Create or view a Gemini API Key link"><figcaption>Google's public key guide, captured October 3, 2026. <a href="https://ai.google.dev/gemini-api/docs/api-key" ${ext}>Source</a>, <a href="https://creativecommons.org/licenses/by/4.0/" ${ext}>CC BY 4.0</a>. This is documentation, not a signed-in dashboard.</figcaption></figure><div class="notice"><strong>Treat your key like a password.</strong><p>Do not publish it, include it in screenshots or send it to support. Use a separate project/key for this extension and review billing and quota controls in Google Cloud. Unpaid API content may be used to improve Google's products; review your account terms before sending private media.</p></div></section>
<section id="start" class="guide-step"><span class="step-label">Step 3 · First session</span><h2>Open a tab. Choose a language. Start.</h2><ol class="instruction-list"><li>Open and play media you are permitted to process in a supported website tab.</li><li>Click the Audivoya icon. Check the source hostname shown under <strong>Dub this tab</strong>.</li><li>Choose your output language under <strong>Listen in</strong>. The selector covers all ${languageCount} documented Gemini Live Translation languages; type a language name while the selector is focused to jump through the list.</li><li>Enter your Gemini API key once. The latest candidate saves it automatically in this browser profile and restores it after restart; no checkbox or extra application is needed.</li><li>Read the visible Google audio-sharing and fees notice (its <strong>Privacy &amp; data</strong> link has the details). Then choose <strong>Start dubbing</strong>, or <strong>Start with sync window</strong> to also open a delayed picture viewer (step 5). Allow the optional Google API permission if your browser prompts you.</li><li>Give the connection and speech translation time to begin. Use <strong>Stop session</strong> or <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> to end capture.</li></ol><figure class="guide-image panel-image"><img src="${url('assets/guide/extension-panel.png')}" width="480" height="504" loading="lazy" alt="Actual Audivoya control panel with AI Dubbing and Captions branding, language selector, empty API key field, Start dubbing and Start with sync window buttons"><figcaption>Audivoya ${site.extensionVersion} installed controls, cropped to the visible popup, with the two Start choices. Owned local setup only; no key entered or live translation shown.</figcaption></figure><p>Closing the panel keeps a native session running. By default, it also continues through videos, reloads and page changes on the same website in that tab. Stop, closing the source tab, moving to a different origin or the selected time limit (if any) ends capture. Stop removes active capture and transport, while the encrypted saved key remains available for reuse. <strong>Forget key</strong> removes the saved key and stops capture.</p></section>
<section id="controls" class="guide-step"><span class="step-label">Step 4 · Controls</span><h2>Adjust audio, captions and speed.</h2><p>Open <strong>Audio &amp; settings</strong> for website continuation, session mode, the time limit, volumes and captions. Audio monitor keeps audio on your device and does not contact Gemini. Live volume controls appear once a session starts.</p><figure class="guide-image panel-image"><img src="${url('assets/guide/extension-settings.png')}" width="448" height="509" loading="lazy" alt="Real Audio and settings controls showing website continuation, session mode and the automatic stop time limit"><figcaption>Audivoya ${site.extensionVersion} settings before Start, cropped to the visible popup. Keep dubbing on this website is enabled by default and the time limit starts at 60 minutes; additional controls appear while scrolling or during a session.</figcaption></figure><ul><li><strong>Keep dubbing on this website:</strong> enabled by default. New videos, page changes and reloads in the selected tab continue the session on the same origin (scheme, hostname and port). Another website or subdomain stops capture; new tabs are not followed. Turn this setting off to stop when changing pages. The original time limit still applies, if you set one.</li><li><strong>Playback speed:</strong> dubbed speech follows the main observable HTML player's speed from 0.25× to 4×. Hidden or custom players may not expose changes.</li><li><strong>Captions:</strong> read original and translated text in the panel, and optionally on the website.</li><li><strong>Export VTT:</strong> downloads captions you have received. Timing follows arrival, so it is not a word-aligned subtitle master.</li><li><strong>Stop automatically after:</strong> choose 5, 15, 30 or 60 minutes, 2, 3, 4 or 8 hours, or <strong>Never</strong>. The default is 60 minutes, and your choice is saved. With Never, capture and audio sent to Google continue, and Google API fees may accrue, until you press Stop, close the tab or leave the website. Provider quota and connection limits still apply.</li></ul></section>
<section id="sync" class="guide-step"><span class="step-label">Step 5 · Sync window</span><h2>Give translated speech a little room.</h2><p>Choose <strong>Start with sync window</strong>, the outlined button below <strong>Start dubbing</strong>, instead of the plain Start. The extension opens a viewer with a locally buffered picture. The default delay is four seconds; adjust it in the viewer to improve alignment.</p><figure class="guide-image"><img src="${url('assets/guide/extension-sync.png')}" width="1280" height="900" loading="lazy" alt="Actual Audivoya sync window showing a delayed picture of a generated demo clip, Fullscreen and Stop session buttons and a collapsed Controls panel"><figcaption>The actual sync window opened by Start with sync window, captured in Audio monitor on an owned generated demo clip. No key or provider was used, so no translated captions are shown; during dubbing, arrival-time captions appear below the picture.</figcaption></figure><figure class="guide-image"><img src="${url('assets/guide/extension-sync-controls.png')}" width="1280" height="900" loading="lazy" alt="Actual Audivoya sync window with Controls expanded: rewind, pause, skip, speed, original and dubbed audio volume, mute and picture delay"><figcaption>Controls expanded: source playback, speed, Original audio and Dubbed audio volumes, mute and the adjustable picture delay. The picture resizes in the remaining space.</figcaption></figure><p>The Controls panel starts collapsed to give the picture more space. The picture resizes within the remaining space when you expand Controls. Use Fullscreen to fill the viewer window; the button changes to Exit fullscreen and follows browser fullscreen changes, including F11. Click again to restore the previous normal or maximized mode. Expand it to play/pause, skip ten seconds, select playback speed, adjust Original audio and Dubbed audio volumes, or mute. Playback commands act immediately on the source player; seeking refills the delayed picture. Use the original tab if the website blocks Play or its custom/embedded player is unavailable here. Keep the viewer open while watching; closing it stops the session. Temporary translation reconnects preserve its delayed picture and original audio. Pause and seek discard old translated audio; seeks while paused wait for Play. Frequent seeks may temporarily wait for a provider-connection slot. If translated audio falls behind during slow playback or a returning burst, Audivoya resynchronizes its bounded buffer without ending capture and shows a notice that speech may be skipped. When a session ends, Audivoya closes its viewer so a new Start opens one fresh window. Captured pictures stay on your device, but may include visible website UI. This adds a picture delay, does not speed up inference and does not guarantee exact alignment.</p></section>
<section id="troubleshooting" class="guide-step"><span class="step-label">Troubleshooting</span><h2>A few quick checks.</h2><div class="faq">${faq('Start is unavailable or no media tab is found.', '<p>Open the actual media website tab before the extension. Browser settings, store pages and unsupported URLs cannot be captured. Close and reopen the panel after switching tabs. Check the displayed hostname.</p>')}${faq('The key is rejected or translation does not start.', '<p>Check project permissions, model access, account region, quota and billing in Google AI Studio. Create a replacement key if your current one is blocked or compromised. In the latest candidate, restart does not require re-entry. For a damaged local record, use Forget key and enter a replacement. Earlier 0.2.10 builds require re-entry after restart.</p>')}${faq('Speech is late or sounds rushed.', '<p>Try normal playback speed, reduce competing audio and check your network. For video, try the experimental sync window and adjust its picture delay. Faster playback can outpace inference; guaranteed instant translation is not supported.</p>')}${faq('I need to report a problem.', `<p>Include browser and extension versions, safe reproduction steps and redacted diagnostics. Never send API keys or private recordings. <a href="${url('support/')}">Contact support</a>.</p>`)}</div></section></div></div>`;

const privacy = `${pageIntro('Clear about your data.', 'Published by Quang Vu. Last updated October 7, 2026. This policy covers Audivoya and its public website.')}<article class="wrap document"><div class="notice"><strong>Audio sharing at a glance</strong><p>Starting dubbing sends selected-tab audio directly to Google's Gemini API. This website does not receive API keys, media or transcripts.</p></div><h2>1. Who operates the product</h2><p>Audivoya is an independent project published by Quang Vu. Contact ${mail} for privacy requests, support or security reports.</p><h2>2. What happens when you start dubbing</h2><p>The extension captures the audio playing in the tab you selected, and sends it directly to Google for translation using your Gemini API account. Google generates translated audio and transcripts. No developer-operated audio server receives this stream.</p><p>Google's retention, data use, charges, quota, model access, age and region conditions depend on your provider agreement and account. Unpaid API content may be used for product improvement or human review. Read the <a href="https://ai.google.dev/gemini-api/terms" ${ext}>Gemini API terms</a> and <a href="https://policies.google.com/privacy" ${ext}>Google privacy policy</a>. Avoid sensitive or confidential media when the applicable terms are unsuitable.</p><h2>3. Credentials and local preferences</h2><p>Audivoya ${site.extensionVersion} automatically saves an AES-GCM encrypted API-key record in extension-origin IndexedDB, scoped to this browser profile. A non-exportable Web Crypto key is stored in the same profile so the extension can restore it without a password or extra application after restart. Audivoya does not sync these objects. Website scripts cannot access this extension-origin database, and credential replies never return a retrieved key.</p><p>This is convenience encryption, not an OS keychain. Someone controlling the browser/profile, privileged extension code, DevTools or malware can recover a usable key. Do not share browser profiles or include them in untrusted backups. Raw keys exist in trusted process memory when used. A temporary session cache lasts up to one hour and is refreshed from the saved record; an active session holds a separate trusted copy for short-lived Google tokens.</p><p>Forget key stops capture and deletes the saved encrypted record, its encryption key and session cache. Stop retains the saved record. Removing the extension or deleting its profile/storage clears local data; filesystem remnants, backups and provider-held records are outside this deletion guarantee. Earlier 0.2.10 builds keep the key only in browser-session memory, expire it after one hour and clear it on restart/reload. Firefox remains a local caption demo and does not save provider keys.</p><h2>4. Audio, picture and caption buffers</h2><p>Audio monitor processes audio locally without sending it to an AI provider. Optional sync viewing captures the selected tab's rendered picture and buffers it locally. Pictures can include the website's visible UI; they are not uploaded to Google by this feature. Video/audio buffers are bounded and cleared on Stop or reset.</p><p>Captions remain in bounded session memory unless you choose Export VTT. A still-open panel may retain previously received captions until it closes. With Keep dubbing on this website enabled by default, an explicitly started session continues through new videos, page changes and reloads on the same origin in the selected tab. It stops on a different origin (including subdomains), tab closure, Stop or the original session time limit (5 minutes to 8 hours; with Never, it continues until you press Stop, close the tab or leave the origin). Navigation events and URLs are checked locally to suspend the old provider connection and verify the committed origin before resuming. The selected tab ID, source origin and observer/generation metadata are held in trusted browser-session storage; full URLs are not persisted or uploaded. Old page captions, speech and sync buffers are cleared on a navigation reset. There is no unrelated-tab collection, browsing-history harvesting or automatic capture at browser startup.</p><h2>5. Exports and deletion</h2><p>Stop session or Alt+Shift+S ends capture and transport and discards active buffers and host transcripts. Closing the control panel preserves a running session; closing the sync viewer ends it. Forget key also deletes the encrypted credential record and its encryption key. Uninstalling removes extension preferences and local storage.</p><p>Caption files and diagnostics are downloaded only when requested. Diagnostics contain aggregate timings, error codes and the selected source hostname, excluding API keys and transcripts. Review exports before sharing. Local deletion does not remove data retained by Google under its own terms.</p><h2>6. Website hosting</h2><p>This static website is hosted by GitHub Pages. GitHub processes visitors' IP addresses and request information for hosting and security under the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" ${ext}>GitHub Privacy Statement</a>. Website assets are served from this site; there are no embedded analytics, advertising trackers, contact forms, third-party fonts or cookies added by this website.</p><p>Following an external link takes you to another service with its own privacy policy. Sending an email shares the content you choose to send through your email service and the publisher's mailbox. Support emails may be retained as needed to resolve a request; you can request deletion, subject to legitimate legal or security obligations.</p><h2>7. Purpose, eligibility and rights</h2><p>Use only media you own or have permission to process. The extension is intended for adults with eligible provider accounts; it is not directed at children. There is no data sale, advertising or automatic developer analytics upload. No DRM or protection bypass is implemented.</p><p>For access, correction or deletion of information you send to the publisher, contact ${mail}. Provider-held data requests must also be addressed to the relevant provider. We cannot promise removal of records held under another provider's terms.</p><h2>8. Changes and contact</h2><p>Material changes will be reflected in this policy's update date and product disclosures. Send privacy or security questions privately to ${mail}; do not include API keys or private recordings.</p></article>`;

const support = `${pageIntro('Let’s get you listening.', 'Find a quick answer, or contact the publisher with safe details about the problem.')}<div class="wrap support-grid"><article class="support-card"><span class="card-badge">Setup guide</span><h2>Set up your first session.</h2><p>The illustrated guide covers provider keys, language selection, controls and optional synchronized viewing.</p><a class="button" href="${url('guide/')}">Open setup guide ${svg.arrowUpRight}</a></article><article class="support-card"><span class="card-badge">Direct contact</span><h2>Talk to Quang Vu.</h2><p>For support, privacy requests or a private security report:</p><p class="support-mail">${mail}</p><p class="small-copy">Do not include API keys, private recordings, sensitive captions or account passwords.</p></article></div><article class="wrap document"><h2>What to include in a support request</h2><ul><li>Your browser name and version, operating system and extension version.</li><li>Steps to reproduce, what you expected and what happened.</li><li>A safe website hostname and whether the problem occurs at normal playback speed.</li><li>Optional redacted screenshots or diagnostics you have reviewed before sharing.</li></ul><h2>Current availability</h2><p>Audivoya ${site.extensionVersion} is publicly available in the Chrome Web Store for desktop Chrome. The Edge Add-ons release has not been published yet. Chrome supports all ${languageCount} documented Gemini Live Translation output languages. Firefox, Safari and mobile live dubbing are not released.</p><h2>Compatibility and timing</h2><p>Not every website, embedded player or protected stream supports capture and media control observation. Main-player speed handling covers 0.25×–4×; AI inference can fall behind faster content. Translation can be inaccurate or delayed. Experimental sync viewing adds an adjustable local picture delay and does not guarantee exact synchronization.</p><h2>Provider access and charges</h2><p>Check your Gemini API project, eligible region, quotas, model access and billing in Google AI Studio. Provider charges are separate from the extension. This website does not sell plans, accept payments or manage provider accounts.</p><h2>Security reports</h2><p>Email ${mail} privately with a reproducible description and minimal, redacted evidence. Do not publish exploit details or credentials in a public issue. Please avoid testing against other people's accounts or recordings.</p></article>`;

const terms = `${pageIntro('Use it thoughtfully.', 'Last updated October 3, 2026. Publisher: Quang Vu.')}<article class="wrap document"><h2>Authorized use</h2><p>Use an authorized, unmodified release of Audivoya for lawful personal or professional purposes. You must have the right to capture, translate and otherwise process the media you select. The product does not grant rights in third-party media, trademarks, voices or generated output.</p><h2>Provider accounts</h2><p>You are responsible for your Gemini account, credentials, charges, quotas and compliance with the provider's terms, including age and regional eligibility. Google operates independently of Quang Vu. No provider access, quota, unlimited use or specific model availability is promised.</p><h2>Translation and compatibility</h2><p>AI output can be delayed, incomplete or incorrect. Review output before relying on it. Audivoya does not guarantee instant translation, exact word synchronization, all websites, protected streams or every browser. It should not be relied on for medical, legal, emergency or other critical decisions.</p><h2>Ownership</h2><p>The original website, extension source, product artwork and documentation are proprietary to Quang Vu except where identified otherwise. Public repository visibility does not grant a general redistribution or modification license. Third-party material retains its own licenses; the screenshot of Google's public API documentation is attributed under CC BY 4.0.</p><h2>Availability and liability</h2><p>The product is provided as available, without warranties to the extent permitted by applicable law. Features, provider access and store availability may change. Nothing here excludes rights or liability that cannot lawfully be excluded.</p><h2>Privacy and contact</h2><p>See the <a href="${url('privacy/')}">Privacy Policy</a> for actual data handling. Contact ${mail} for questions. Quang Vu is not affiliated with Google, Microsoft, browser vendors or the media websites you use.</p></article>`;

export const pages = [
  {
    route: '',
    title: site.title,
    description: `Get Audivoya for desktop Chrome. Hear web audio in all ${languageCount} Gemini Live Translation languages with bilingual captions and playback controls. Edge release coming soon.`,
    body: home,
  },
  {
    route: 'guide/',
    title: 'Setup guide · Audivoya',
    description:
      'Prepare your Gemini API key and learn how to use Audivoya, captions, playback controls and experimental synchronized viewing.',
    body: guide,
  },
  {
    route: 'privacy/',
    title: 'Privacy Policy · Audivoya',
    description:
      'How Audivoya handles selected-tab audio, Gemini credentials, captions, local sync pictures and website hosting.',
    body: privacy,
  },
  {
    route: 'support/',
    title: 'Support · Audivoya',
    description:
      'Contact Quang Vu for Audivoya support, privacy questions and private security reports. Review current compatibility and provider requirements.',
    body: support,
  },
  {
    route: 'terms/',
    title: 'Terms of use · Audivoya',
    description:
      'Responsible media use, provider account requirements, product ownership and current limitations for Audivoya.',
    body: terms,
  },
];
