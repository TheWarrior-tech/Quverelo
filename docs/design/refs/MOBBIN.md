# Mobbin UI Research — Quvrelo Reference Doc

## Apps to cover (6 of): Figma, Framer, Linear, Canva, Raycast/Arc, Notion, Pitch/Spline
## Screen types sought per app: onboarding/home, toolbar/tool rail, inspector/properties panel, layers panel, command palette/search, modal dialog, empty states, toasts/menus

---

## FIGMA

### Screens inspected

**1. Figma Web Onboarding Flow**
- URL: https://mobbin.com/explore/flows/bddead9d-c072-4fa7-84e9-a33b666c2f03
- Content: 18-screen flow. Screen 1 = Figma marketing homepage. Screen 2 = "Welcome to Figma" sign-up modal over a dimmed (gray-scrim) homepage.

**2. Figma Web Project Overview** (files/home/project browser + right panel)
- URL: https://mobbin.com/explore/screens/006a360c-04a1-4e7d-9437-ec8ed31a1c76
- Content: Three-zone project browser with dark top bar, left sidebar, main files area, and right "About / contributors" panel.

**3. Figma Web Editor Selection** (modal / billing dialog)
- URL: https://mobbin.com/explore/screens/13738623-8ea5-4e15-9e28-0b81cde61737
- Content: 3-step progress wizard (Adjust editors → Payment → Review) with inline team table and right billing summary.

**4. Figma Web Design Templates** (collection browse)
- URL: https://mobbin.com/explore/screens/aaae639c-ad41-40fb-956d-81958780b8cf
- Content: Design template page with filter options and template cards (Breadcrumbs & Grid List UI elements).

**5. Figma Web Authenticator app choice** — search exists (URL not yet opened)
**6. Figma Web Project Type Selection** — search exists
**7. Figma Web Plugins** — search exists
**8. Figma Web Team creation** — search exists
**9. Figma Web AI Processing** — search exists
**10. Figma Web Grouping layers Flow** — search exists (layers pattern!)
**11. Figma Web Adding a template Flow** — search exists
**12. Figma Web Community Resources Grid** — search exists**13. Figma Web Design Interface** (main editor — the one that matters)
- URL: https://mobbin.com/explore/screens/24933190-a2b0-4d37-b79f-5b80c9adab7e
- Content: Blank design file. 3-zone layout: LEFT = layers panel (Figma menu, file name "Untitled" / Drafts · Free, File/Assets tabs + search, Pages list with "Page 1" + "+", empty Layers list). CENTER = light-gray empty canvas (#F5F5F5). RIGHT = top row (user avatar "S", Play/Present, blue Share), Design/Prototype tabs + zoom 100%, page fill F5F5F5 100%, then sections Local variables, Local styles, Export. Bottom toolbar clipped at bottom.

**Figma observable design patterns (from screens 1, 2, 3, 4, 13)**
1. **Three-zone "holy grail" editor layout:** persistent left rail (layers/pages/assets), full central canvas, persistent right properties panel. Clear separation, no overlap. Canvas is the hero.
2. **Monochrome chrome, color-by-intent:** UI chrome is black/white/gray (#F5F5F5 canvas, near-white panels). Color is reserved for CTAs (blue Share button), active states, and collaboration indicators — keeps it readable for beginners.
3. **Clear primary/secondary button hierarchy:** Filled black primary ("Get started for free", "Continue with email", "Next: Payment information") vs outlined secondary ("Contact sales", "or" dividers). Consistent from marketing to onboarding to wizard.
4. **Context-preserving modals with dimmed scrim:** Sign-up modal opens over the live homepage (not a page nav). Gray backdrop keeps spatial context and the entry trigger visible.
5. **Progressive onboarding:** Social-first auth ("Continue with Google") → "or" → single email field with auto-focus (blue focus ring) → only one field per step. Reduces commitment anxiety for new users.
6. **Wizard with step-progress and right-side summary:** 3-step progress indicator (Adjust editors → Payment → Review) top of dialog; right sidebar shows live billing summary ("Professional plan", annual/monthly toggle, line-item math, Subtotal) with a blue "Next" CTA. Beginner can see consequences of choices immediately.
7. **Tab-based mode switching in panels:** Left panel "File / Assets" tabs; right panel "Design / Prototype" tabs. Same panel, different content — avoids adding new rails.
8. **Compact layer/tree list with expanders:** Pages section with "+" add; Layers list (empty state shown). Tree control pattern: icon + label, indentation signals nesting.
9. **Project browser with consistent left-nav + main + right-panel pattern:** Dark top bar (search "Search files, teams, people", notifications, Explore Community, avatar). Left sidebar: Recents, Drafts, Favorites (empty), Teams (with selected team highlighted, "Create new team"). Main: "New design file" / "New FigJam file" cards, Filter/Sort, grid/list toggle. Right panel: About (description prompt), Recent contributors, Starter team overview with usage gauges. Teaches the same 3-zone grammar from home into editor.
10. **Empty states with guidance, not blank:** "Add a description", "Favorite files (empty)", Recent contributors empty, Favorite files empty, Layers empty — each gives a verb or shows the empty list container clearly so beginners know something lives there.
11. **Repeated search at every level:** Top-bar "Search files, teams, or people"; left-panel search inside File/Assets. Search is a navigation primitive, not an afterthought.
12. **Section grouping with headings + divider lines:** Right panel stacks About → Recent contributors → Team overview as titled card sections. Visual rhythm helps scanning.## FRAMER

### Screens inspected

**1. Framer Web Design Canvas**
- URL: https://mobbin.com/explore/screens/12e8f4e8-14d4-43bc-8188-ae7d8b4aa063
- Content: Full editor. Top toolbar (Framer menu + tool icons: insert, layout, text, CMS, interactions; center = project name "My Project · nuanced-course-146180.framer.app" with FREE badge; right = JD avatar, globe, settings, play/preview, Invite, blue Publish). Left panel: Pages/Layers/Assets tabs; Pages list (Home selected, /blog). Center: live page preview with selected Twitter embed (purple selection handles). Bottom canvas toolbar: tool icons, 50% zoom, "Upgrade Now" CTA. Right properties panel for selected Twitter embed: collapsible sections Position (Type = Relative), Size (Width 400 Fixed, Height 225 Fixed, Min Max "Add…", Fit Content), Effects/Cursor (+ to add), Styles (Opacity 1, Visible Yes/No), Transforms (+ to add), and component section "Twitter (Component)" with URL + Theme.

**2. Framer Web Welcome Modal** (onboarding modal over editor)
- URL: https://mobbin.com/explore/screens/8a5e4f0f-61a9-4dc4-849e-59ebfd4f50f3
- Content: "Welcome to the new Framer" modal with tutorial promo banner (template previews, avatar, headline "Want a product that customers love…"). Body copy + dual CTA: "Start Tutorial" (blue, primary filled) and "See What's New" (light gray, secondary). Editor visible behind dimmed: same toolbar (Insert/Layout/Frame/Text/CMS; project Untitled + FREE badge; Publish), left Pages/Layers/Assets tabs with pages Home /about /contact /404, right panel Layout/Effects/Styles, bottom "Upgrade Now" bar.

**Framer observable design patterns**
1. **Four-edge chrome (top toolbar + left panel + right panel + bottom bar):** Unlike Figma's three-zone, Framer adds a bottom canvas bar for zoom/tools/upgrade. Editor real estate is framed on all 4 sides; center canvas is still the hero.
2. **Icon-only top tool toolbar grouped by capability:** Insert, Layout, Frame, Text, CMS, Interactions — vertical or compact icon buttons along the top, labeled only by icon + likely tooltip. Reduces cognitive load by keeping the top uncluttered; beginners learn the palette, not words.
3. **Tabbed left panel (Pages / Layers / Assets):** Same real estate serves three roles via tabs. Switching Pages↔Layers doesn't add width — a deliberate density choice for creative workflows where the page list matters as much as the layer list.
4. **Right-side "properties-by-selection" inspector with collapsible sections:** Position, Size, Effects, Styles, Transforms, then a custom component section for the selected embed. Each section has its own heading, "+" to add, Fit Content helper. Grouping matches the mental model of "what properties does this element have."
5. **Contextual selection handles on the canvas:** Purple selection handles around the selected Twitter embed — color (purple) is Framer's brand/sel color, providing a clear active state. Handles + property panel are linked (select → properties populate).
6. **Live page preview is the canvas — no abstraction layer:** The canvas shows the actual published page (headings, image placeholders with hatched pattern, Get Started button, second breakpoint preview). Beginners instantly see what they're building.
7. **Project identity in the toolbar spine:** Center shows project name + .framer.app domain + FREE badge. Always visible, never hidden behind a popover. Communicates publish destination and plan status at a glance.
8. **Onboarding modal over the editor (not a separate page):** Welcome modal sits over a real, live editor with a template project already loaded (pages Home /about /contact /404, bottom Upgrade bar). Two CTAs: "Start Tutorial" (learn) vs "See What's New" (explore). Lets a beginner choose depth.
9. **Consistent primary/secondary button grammar:** Blue filled primary (Publish, Start Tutorial), light-gray/outline secondary (See What's New). Matches Figma's filled-vs-outlined system.
10. **Bright brand color only on CTAs and selection state:** Purple selection handles, blue Publish/Start Tutorial. Chrome is neutral. Color guides the eye to "do" and "selected."## LINEAR

### Screens inspected

**1. Linear Web Kanban Board Screen**
- URL: https://mobbin.com/explore/screens/29621c0a-9946-46aa-9d39-6d5f4f578b21
- Content: Project "User Insight & Behavior Analytics Dashboard" in AS Mobbin workspace. Three tabs top: Overview / Issues (selected) / Updates. Kanban columns: Todo (2/3), In Progress (2), Done (11, 6 visible — sub-issues of parent "Conduct stakeholder interviews"). Hidden columns: Backlog, Canceled, Duplicate. Cards show keyline number (AS-12), title, labels (small colored chips: Documentation / Analytics / Feature / Research / UX), due date, created date. Footer: "1 issue hidden by filters" with "Clear Filters ×". Sidebar: Inbox, My issues; Workspace section Projects/Views/More; Your teams (AS Mobbin with Issues/Projects/Views); bottom "Try:" Import issues, Invite people, Connect GitHub.

**2. Linear Web Dark mode app** (main list view, dark)
- URL: https://mobbin.com/explore/screens/cc5d476b-5ba1-4bc2-bcf3-d6dcc9a636a3
- Content: Dark theme main interface. Sidebar: user "John Mobbin", a "New issue" button, Inbox, My issues, Views. Your teams → Issues (Active selected, Backlog), Projects, Views. Bottom: Invite people, Help & Support, "Import Issues" card. Main panel: "Active issues" heading with Filter and View controls. List shows 1 in progress (JOH-11 "Mobile browsing") and 11 Todo (JOH-12, JOH-1, JOH-5 …).

**3. Linear Web New Issue Dialog** (modal dialog)
- URL: https://mobbin.com/explore/screens/be8e5272-be5c-4faf-9caf-5ebff30e45ff
- Content: "New issue" dialog over dimmed Linear. Header: team chip "JOH" › "New issue" breadcrumb with expand (↗) and close (✕). Fields: "Issue title" placeholder, "Add description…" placeholder. Property chips row: Todo (status), Priority, Assignee, Label, ••• overflow. Footer: paperclip attachment icon (left), "Create more" toggle, purple "Create issue" primary button. Background shows list with tips like "ProTip: Mouse over this issue & press [Space]".

**Linear observable design patterns**
1. **Dark-first palette, light text, generous contrast:** The entire Linear web app is shown in dark mode — dark background, light text, muted borders. Communicates a premium developer tool and reduces eye strain during long sessions.
2. **Compact, dense sidebar with progressive sections:** Sidebar stacks short sections: quick actions (Inbox, My issues) → Workspace (Projects, Views, More) → Your teams (expandable) → bottom "Try:" area (Import, Invite, Connect GitHub). Small type, tight spacing, but clear section separation.
3. **Issue-keyline + title + chips card pattern:** Every card leads with a monospaced-ish keyline number (AS-12, JOH-11), then title, then small colored label chips (Documentation, Feature, UX). Keyline is a unique ID beginners learn to reference; the card is skimmable.
4. **Chips as first-class property controls:** Status (Todo), Priority, Assignee, Label are shown as small rounded chips — inline in the new-issue dialog and as filters on cards. Tapping a chip opens its editor inline. Extremely compact property editing.
5. **Centered, narrow dialog with a clear spine:** "New issue" dialog has a single column: header breadcrumb (team › New issue + expand + close), title field, description field, property chips, footer (attachment + Create more toggle + purple Create issue). One mental model: read top to bottom, act at bottom.
6. **Action in the dialog footer, never mid-dialog:** Primary CTA (purple "Create issue") sits at the bottom with a "Create more" toggle next to it. Attachment is at the left. Beginners know where the final action is.
7. **Breadcrumb header that doubles as context + expand:** "JOH › New issue" tells you the scope (team chip) and includes an expand (↗) to pop out the dialog into its own view. Teaches the user a reversible deeper view without a separate navigation.
8. **Inline filter chips with a clear "Clear Filters ×":** Kanban footer "1 issue hidden by filters" surfaces the active filter state with one-tap dismissal. Beginners always know what's filtered.
9. **Empty/scaffolding content teaches while you work:** Default project ships with issues like "Welcome to Linear", "Use Projects to organize…", "ProTip: Mouse over this issue & press [Space]". The app uses the issue format itself to onboard — no separate tutorial required.
10. **Consistent purple brand accent only on primary CTAs and active states:** "Create issue" button is purple, status chips use color, sidebar selection uses a highlight. Rest of UI is neutral gray-on-dark.
11. **Column-grouped kanban with counts and hidden columns:** Column header shows "Todo (2 / 3)" — current / capacity. Extra state columns (Backlog, Canceled, Duplicate) are collapsed by default so the board isn't cluttered.
12. **Dense, monoline list (dark mode app):** "Active issues" shows each issue as one line with keyline + title. Filter and View controls sit in the heading row. High info density, low decoration.### Canva — screens inspected and Mobbin URLs

1. **Canva Web Design Interface** — `https://mobbin.com/explore/screens/cdfefd49-9ad1-4a35-9bea-ffa86263f3ac`
   - Top toolbar: Menu, File, Resize (crown icon for Pro), Editing dropdown, Undo/Redo, cloud save, "Learn the basics" (help), avatar "AS" with +, Insights, Comments, Present, Share.
   - Left sidebar (vertical): Design, Elements, Text, Brand (crown), Uploads, Tools, Projects, Apps, Magic Media — icon + label per row.
   - Canvas: presentation slide "Canva 101 playbook" with Canva logo, collaborator cursor "Beau" on the text, photos on right including a "Keep it simple." graphic.
   - "Design together" popup (contextual first-use tip): "Share your design to edit live with other people, leave comments and always have the most up to date link." with a single **Got it** button.
   - Share design panel (right or side drawer): "0 visitors", People with access (search "Add people or groups" + AS avatar), Access level "Only you can access", Copy link button; Options list: Download, Present, Public view link, Print with Canva, Brand Template, Present and record, Website, See all.
   - Bottom page strip: 8 slide thumbnails (Canva 101 playbook → Try templates → Add text → Drag and drop elements → Make it pop with colors → Play with video → Visualize data with charts → Happy designing!), plus add-page (+).
   - Patterns:
     - Horizontal icon+label left rail for content categories (Design, Elements, Text, Uploads, Apps, Magic Media) — broad content palette rather than a layers list; each row has a small icon and a text label, keeping the rail scannable.
     - Top toolbar split into three semantic zones: document controls left (Menu, File, Resize, Editing, Undo/Redo, cloud save), a help/onboarding pill center-left ("Learn the basics"), and collaboration/publishing right (Insights, Comments, Present, Share, avatar +).
     - Pro features marked with a small crown icon inline (Resize, Brand) rather than a paywall overlay — communicates Premium without blocking.
     - A bottom page/slide strip of small thumbnails + add-page, giving an at-a-glance project structure for multi-page documents.
     - Contextual first-use "Design together" popup: single focused message with a single "Got it" CTA — progressive onboarding that teaches one concept and dismisses.
     - Share panel surfaces both access (searchable "Add people or groups", access-level control, Copy link) and downstream output actions (Download, Present, Website, Print, Brand Template, See all) in one drawer — discoverable in one place.
     - Collaborator cursors with name labels ("Beau") drawn directly on the canvas — multiplayer presence is visible in the work area.
     - Light, colorful content (slides, photos, logo) against a neutral chrome; iconography uses simple line/duotone icons consistent across the rail.
Continuing Canva section with more screens:

2. **Canva Web Homepage** (marketing/landing home) — `https://mobbin.com/explore/screens/1277bb22-3377-439b-82a1-daf7bb3d9f3f`
   - Nav: Canva logo, Design spotlight, Business, Education, Plans and pricing, Learn (each with dropdown arrows), search icon, help icon, "Log in" + purple "Sign up" pill.
   - Hero headline: "What will you **design** today?" with the word "design" in a teal-to-purple gradient.
   - Subheading: "Canva makes it easy to create professional designs and to share or print them."
   - CTA: purple "Start designing" button.
   - Category carousel (with left/right arrows): Docs, Whiteboards, Presentations ("Present with ease"), Social ("Perfect your post"), Videos, Prints ("You're invited!"), Websites.
   - Next section heading: "A perfect fit for everyone".
   - Patterns: marketing nav is a top horizontal rail with the only two auth CTAs (Log in plain text, Sign up purple filled pill) — clear hierarchy; headline uses a brand-gradient on the action word ("design") to reinforce the value prop; single primary CTA ("Start designing") with no competing secondaries on the hero; horizontal scrollable category carousel of document-type cards (Presentations, Social, Videos, Prints, Websites) each with a short benefit subline — acts as a category entry point that reads like a template gallery; copy uses second-person benefit ("Perfect your post", "You're invited!") for approachability.

3. **Canva Web Intended Use Modal** (onboarding first-use modal) — `https://mobbin.com/explore/screens/521eac48-6388-4970-90c6-8af937d86508`
   - Heading: "What will you be using Canva for?"
   - Subtext: "We'll use this to recommend designs and templates especially for you."
   - Six option cards in a 2×3 grid: Personal (palette), Small business (storefront), Teacher (book w/ apple), Student (backpack), Large company (office), Non-profit or charity (heart in hand). Each card has a friendly one-liner ("You're here to make anything and everything", "design your brand from the ground up", "scale your brand and keep it consistent", etc.).
   - Behind the modal: blurred Canva homepage with "What will you design today?" banner.
   - Patterns: first-use modal asks a single, low-friction preference question with a short explanatory subline that justifies why ("recommend designs and templates especially for you"); six large option cards in a 2-row grid with a custom icon + headline + one-line personality copy per card — readable at a glance and friendly to beginners; the homepage behind the modal is blurred (not replaced), so the user still senses the real environment; no "skip" friction in this particular shot — the question is positioned as a helpful customization, not a gate.
### Notion — screens inspected and Mobbin URLs

1. **Notion Web Notion Workspace** (home/dashboard post-login) — `https://mobbin.com/explore/screens/cbf7d1f7-7603-405e-ba9e-dc7573bc71e4`
   - Sidebar: Workspace name ("Alex Smith's Noti..."), top quick links Search / Home (selected) / Inbox; "Private" section with pages (SLMobbin Creative Strat..., Welcome to Notion!, Weekly To-do List, Habit Tracker); "Shared" section with a "+ Start collaborating" affordance; footer Settings / Templates / Trash / Invite members.
   - Main area: greeting "Good evening"; a large AI box "Ask or find anything from your workspace…" with Ask / Research / Build modes and an "All sources" option; "Recently visited" list (SLMobbin Creative..., Welcome to Notion!, Teamspace Home, Document Hub, …); "Upcoming events" (Today Jul 11: Landing page; Sat Jul 12: Flag Banner); "My tasks" list with a "New task" button and a table of task / date / project / checkbox (Landing page · Jul 11, 2025 · Creative pipeline · checked; Ad Spot · Jul 15 unchecked; Studio Reel · Jul 16 unchecked).
   - Patterns:
     - Left sidebar organized into named, collapsible zones (quick links, Private pages, Shared pages, footer utilities) with a "+ Start collaborating" inline affordance rather than hiding collaboration behind a deep menu.
     - Home workspace is a greeting + vertically stacked module list (AI box, Recently visited, Upcoming events, My tasks) — a dashboard of "what matters now" rather than a file-tree, approachable for a first-time user.
     - AI search/compose box surfaced at the very top of the home ("Ask or find anything…") with mode pills (Ask / Research / Build) and an "All sources" scope — positions AI as a first-class command/find surface.
     - Tasks rendered as an inline table with checkbox, date, project column — mixing a list/table view with the page context.
     - Section headers use plain title text ("Recently visited", "Upcoming events", "My tasks") with no heavy chrome; density is moderate and vertical rhythm is driven by whitespace.
     - Monochrome, low-saturation chrome (grays/blacks) keeps the page content and AI module prominent; typography is a clean sans-serif with a clear headline/body hierarchy.

2. **Notion Web Saved Document** (document editor context) — `https://mobbin.com/explore/screens/1cb8d0cf-f899-420b-9edf-5fb944d09671`
   - A Notion workspace ("Alex Smith's Noti...") with an AI chat panel in the middle covering creative design trends, and a document titled "Top Creative Design Trends in 2025" open on the right.
   - Top-right of the document: Share button, comment icon, star (favorite), "…" overflow menu.
   - Patterns:
     - Document chrome is minimal: only Share, comment, star, and "…" menu at the top right — no persistent toolbar, no right inspector panel in this view. Actions relevant to the page live as a tight set of icons.
     - Multi-pane / split-view arrangement is supported: an AI conversation can sit alongside an open document, suggesting Notion treats AI as a parallel work surface rather than a modal interruption.
     - The AI panel reads like a chat (conversational width, message list) contrasting with the structured document — a composability model where different "apps" (chat vs doc) share one canvas.

3. **Notion Web Notion Welcome Page** (seeded onboarding doc) — `https://mobbin.com/explore/screens/e01acbab-f616-4045-993a-3a4786411c53`
   - Description: "Notion welcome page with a visible sidebar and a checklist of getting started tasks."
   - Sidebar (left): same pattern — Workspace "Alex Smit...", Search / Home / Inbox, Private: "Welcome to Notion!" (selected), Weekly To-do List, Habit Tracker; Shared: "+ Start collaborating"; footer Settings / Templates / Trash / Invite members.
   - Top bar: "👋 Welcome to Notion! · Private | Edited 23h ago · Share · ☆ · ⋯"
   - Main content body:
     - 👋 **Welcome to Notion!**
     - ☑ ~~Create an account with Notion~~ (pre-checked, strikethrough — the user has already completed this)
     - ☐ Click anywhere below and **type `/`** to see what you can create – headers, tables, to-do's, etc.
       - ☐ Type `/page` to add a **new page** and nest anything, anywhere
     - ☐ **Find**, **organize**, and **add new pages** using the sidebar to the left 👈
     - ▶ "This is a toggle block. Click the little triangle to see a few more useful tips!" (a toggle block preview)
   - Patterns:
     - Onboarding lives as an editable, seeded document rather than a modal wizard — the "Welcome to Notion!" page is just another page in the user's workspace, so exploring the onboarding is indistinguishable from using the product.
     - Uses an inline checklist (checkbox blocks) with progressive disclosure: first item ("Create an account") arrives pre-checked with strikethrough so the user sees progress; subsequent items teach one interaction each (`/` slash commands, nesting with `/page`, using the sidebar).
     - Inline bold emphasis on the exact keystroke/surface being taught (**type `/`**, **new page**, **the sidebar to the left** 👈) — highlights the mechanism, not the outcome.
     - A toggle block is seeded directly in the onboarding to demonstrate the toggle interaction ("Click the little triangle to see a few more useful tips!") — teaching the primitive by giving a live one.
     - Emoji in the heading (👋) and inline pointer emoji (👈) add a friendly, human tone without heavy illustration.
     - Document metadata in the top bar ("· Private | Edited 23h ago") teaches the sharing/ownership and recency concepts at the same place they live in real docs.
### Pitch — screens inspected and Mobbin URLs

1. **Pitch Web Design Customization** (presentation editor with design panel) — `https://mobbin.com/explore/screens/079b35a8-c000-4b5f-badb-af774e3810b6`
   - Top bar: document "Untitled presentation" with status "💪 In Progress" and an undo arrow; toolbar with labeled buttons Text, Media, Shape, Sticker, Chart, Table, Embed, Record; right side has bell, search, add-collaborator button with "JA" avatar, headphones, analytics, a blue **Share** button, and a Play ▶ button.
   - Left slide panel (vertical filmstrip of 9 slides): Moodboard (white, selected), Moodboard (dark blue texture), Moodboard (yellow), Background & context, Color swatches image with caption, "Structure-wise, you have two options with this template.", Typography (black), Cargo image (red), Animations (black).
   - Main canvas (slide 1): "By" Eugene Millwood / "On" January 1 / large "**Moodboard**" headline.
   - Right sidebar tab strip: Design, Workflow, Comments, Reactions, Notes, History. A tooltip reading "**Open design panel**" is displayed next to the Design icon.
   - Patterns:
     - Three-rail creative layout (left slide filmstrip, central canvas, right inspector/context panel) — the same structural pattern as Figma/Framer but with a slide thumbnail rail instead of a layers list.
     - Top toolbar uses small labeled buttons with text labels (Text, Media, Shape, Sticker, Chart, Table, Embed, Record) rather than icon-only — discoverable and beginner-friendly; each button name is the action it performs.
     - Document identity and state shown together in the top bar: name ("Untitled presentation") + status chip ("💪 In Progress") + undo, which communicates both what you're editing and where it is in the workflow.
     - Right-side context rail is a vertical tab strip (Design / Workflow / Comments / Reactions / Notes / History) — switches between concern areas without leaving the editor; a tooltip "Open design panel" teaches the interaction on first use.
     - Slide filmstrip on the left uses large, colorful thumbnails that are recognizable at small size, with a clear selection highlight — rapid visual navigation of the deck.
     - Collaboration/publishing actions gathered on the top-right (Share as blue primary, Play to present, analytics, headphones for audio, add-collaborator with avatar, bell for notifications) — a consistent "outbound actions" zone.
     - Mobbin tagged this screen's UI elements as Tooltip + Side Navigation + Adding & Creating + Editing & Updating + Showing & Hiding — confirms Pitch surfaces contextual tooltips alongside structural side rails.

2. **Pitch Web Workspace Home** (workspace home + empty state) — `https://mobbin.com/explore/screens/0637549d-40fe-4ee3-ad78-19e8483efead`
   - Description: "Workspace displaying in progress presentations with a prominent call to action to create a new presentation."
   - Top bar: "Jane's workspace" with a "Starter" badge and user "Jane Smith"; bell, search, "Add members", and a blue **"+ New presentation"** button.
   - Left sidebar: "Upgrade this workspace" with PRO badge; Dashboard; Templates (→ chevron expands); Workspace folders (+) containing Home and "💪 In Progress" (selected) with a sub-folder "👀 Researching"; "Manage library →" at bottom.
   - Main area: Heading "💪 In Progress" with a "…" menu; subtitle "Create presentations that everyone in your workspace can access"; folder card "👀 Researching, 0 items"; a friendly illustration of a hand placing a slide into a folder; empty-state heading "What will your team create here?"; body copy explaining shared vs private; blue "+ New presentation" button.
   - Patterns:
     - Workspace home uses a two-zone shell: a persistent left folder/project tree and a spacious main area that adapts to the selected folder's contents.
     - Empty state is fully composed: contextual illustration (hand placing a slide in a folder) + an empathetic question headline ("What will your team create here?") + explanatory body copy that teaches a concept (shared folder vs private folder) + a primary CTA ("+ New presentation") that does the obvious next thing. This is one of the strongest empty-state patterns observed.
     - Folders can carry emoji labels and short status-style prefixes ("💪 In Progress", "👀 Researching") that act as visual tags without color — lightweight way to differentiate project states.
     - The workspace-level top bar carries identity ("Jane's workspace"), a plan badge ("Starter"), search, an "Add members" affordance, and a single blue "+ New presentation" CTA — plan tier and primary create action live in chrome, not hidden in menus.
     - Upgrade affordance ("Upgrade this workspace" with PRO badge) sits at the top of the sidebar — visible but non-blocking, the same non-interstitial upgrade treatment seen in Figma/Framer/Canva.
     - "Manage library →" chevron at the sidebar bottom groups a secondary deep action (brand/template library) out of the main scroll.
### Availability note on Raycast / Arc on Mobbin
- **Raycast**: Searching `mobbin.com raycast web` surfaced only a "Raycast Store: Mobbin Search" extension (a Raycast Store listing for a Mobbin-search extension at raycast.com › noss › mobbin) and the Raycast Companion Chrome extension. No Raycast web-app screens were found on mobbin.com in this run.
- **Arc**: Mobbin's Arc coverage was limited to mobile — e.g. "Arc Search iOS Instruction screen" and "Arc Search iOS Website Details" under Explore › Mobile › Screens. No Arc web-app screens were surfaced.
- The task allowed "Raycast or Arc" and "Pitch or Spline", so **Pitch was taken as the representative** in place of Raycast/Arc. All six required apps were therefore covered via Mobbin: Figma, Framer, Linear, Canva, Notion, Pitch.
## 10 strongest cross-app patterns to adopt for Quvrelo

1. **Three-rail creative shell (left · canvas · right).** Figma, Framer, Canva and Pitch all use a left rail (layers/assets/pages/slide filmstrip), a central infinite or page canvas, and a right inspector/context panel. Adopt this as Quvrelo's default editor topology; the left rail carries structure (layers, assets, pages, slides), the right rail carries properties and context for the selection.

2. **Left rail as a tabbed/sectioned rail, not a single list.** Figma separates File/Assets/Pages/Layers into tabs; Framer uses Pages/Layers/Assets tabs; Linear groups the sidebar into personal / workspace / teams; Notion groups into quick-links / Private / Shared / footer; Pitch shows Dashboard, Templates, Workspace folders, Manage library. Give Quvrelo's left rail tabs or collapsible named zones so a beginner isn't confronted with one long mixed list.

3. **Right-side inspector grouped into concern tabs, with a component-specific section at the bottom.** Framer stacks generic controls (Position, Size, Effects, Styles, Transforms) above a component-specific "Twitter" block; Figma uses Design/Prototype mode tabs; Pitch uses Design/Workflow/Comments/Reactions/Notes/History tabs. Group Quvrelo's right panel into tabs by concern (Properties, Appearance, Interactions/Animation, Data/Content, History) and push the selected-object-specific controls into their own labelled region at the bottom.

4. **Top toolbar split into semantic zones.** Across the apps the top chrome splits naturally into: document/project identity (name, status, plan badge) at left or center, tool/insert controls, and collaboration + publish + presence at the right (Share/Publish/Play, avatars, comments, analytics). Mirror this: identity + tools + outbound actions, with the primary ship CTA (Share/Publish/Export) as the only filled/highlighted button on the right.

5. **Neutral canvas surface so artwork stands out.** Figma uses a light #F5F5F5 canvas; Framer/Pitch render the design itself; Linear and Notion use large white content areas with low-saturation chrome. Keep Quvrelo's work area on a neutral background (light default, true dark theme as a full shell), and let the user's content/artwork carry the color.

6. **Selection and hover states that read from across the room.** Framer uses vivid purple selection handles on selected elements; Pitch highlights the selected slide thumbnail in the filmstrip; Linear highlights the active sidebar item; Notion highlights the selected sidebar page. Use a high-contrast selection color (a brand tint, not a neutral) for the selection ring/handles, plus a lighter hover fill on rows and thumbnails, so selected vs hovered vs unselected is unambiguous.

7. **Inline, contextual tooltips and first-use hints instead of a tutorial wall.** Pitch shows a literal tooltip bubble ("Open design panel") next to the Design icon; Canva drops a single focused "Design together" popup with one "Got it" CTA; Framer's welcome modal leaves the real editor visible behind it dimmed; Figma surfaces "Learn the basics" inside the toolbar. Annotate Quvrelo's chrome with lightweight, dismissible tooltips on the user's first session (tool rail icons, right-panel tabs, share/export), and remove them after — don't force a multi-screen tutorial.

8. **Empty states that teach and action, never just say "nothing here".** Pitch's workspace home is the strongest example: contextual illustration + empathetic question ("What will your team create here?") + explanatory copy that teaches a concept (shared vs private) + a "+ New presentation" CTA. Figma's project overview shows actionable placeholders ("Build your own team library", "Add a description") and a usage progress nudge ("1 of 3 files used"). Linear seeds friendly example issues ("Welcome to Linear", "Use Projects to organize work…") plus an inline ProTip ("Mouse over this issue & press [Space]") instead of a hard empty state. Quvrelo's empty canvas, empty layers, and empty workspace should each carry: a small contextual illustration, one line of teaching copy, and a primary button that does the obvious next action (e.g. "New layer", "Start a design", "Open a template").

9. **Progressive, contextual onboarding — not a wizard.** Canva's intended-use modal asks one preference question with a short "why we ask" subline and six big option cards; Figma signs you up via an in-page modal that keeps you in context; Framer's welcome modal offers a tutorial-or-explore choice with the editor still visible behind; Notion bakes onboarding into a normal, editable "Welcome to Notion!" page with inline checkbox checklists, bolded keystrokes (`/`, `/page`), and a live toggle block seeded to demonstrate the toggle; Linear seeds example issues that double as lessons. Quvrelo should: (a) ask at most one lightweight preference on first run (goal/role) with a "why"; (b) deliver a seeded "Welcome to Quvrelo" project that teaches via live, editable examples (a shape with a live stroke control, a grouped layer, a component), not a separate walkthrough; (c) keep the real editor visible behind any first-run overlay.

10. **Upgrade/premium surfaces that inform without gating.** Every app observed marks premium in chrome without blocking: Figma's crown icons on Resize/Brand and inline "View plans" cards; Framer's "FREE" and "Upgrade Now" badges in the canvas chrome; Figma's "Upgrade your team" link in the right rail and "Upgrade" card in the sidebar; Canva's crown icons on Resize and Brand; Pitch's "Starter" workspace badge plus "Upgrade this workspace" / PRO card in the sidebar. Quvrelo should surface Pro/Team via a small inline badge or labelled affordance (crown or "PRO"/"Upgrade" chip) adjacent to the relevant feature — never a paywall modal interrupting the editor, and never a modal that can't be dismissed.

**Supporting patterns (honorable mentions that feed into the above):**
- **Consistent "outbound actions" zone** on the top-right: Share (blue primary) + Play/Present + Publish + Present/Record + analytics (Figma, Framer, Pitch). Make Share/Publish the single filled CTA there.
- **Collaborator presence drawn into the work area**: named cursors on the canvas (Figma's Xi/Alex/Francis, Canva's "Beau") rather than only an avatar pile.
- **Small, friendly emoji/label tags** to mark state or personality without color (Linear's key prefixes, Notion's 👋/👈, Pitch's 💪 In Progress / 👀 Researching, Framer's FREE badge). Lightweight tags reduce reliance on color alone.
- **Document metadata in the chrome, not a menu**: name + recency/ownership chips ("· Private | Edited 23h ago" in Notion; "Untitled presentation · 💪 In Progress" in Pitch) teach ownership/recency where users already look.
- **Command surfaces surfaced as inline controls, not hidden**: Notion's AI box ("Ask or find anything…") with Ask/Research/Build mode pills at the top of the workspace; Figma's global "Search files, teams, or people" bar in the top chrome; Linear's Filter/View inline bar. Even where a full command palette wasn't captured on Mobbin, every app puts search/command at the top, reachable without opening a panel.
