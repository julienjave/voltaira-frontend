![Voltaira logo](public/assets/Voltaira-logo.png)

**Voltaira** is a lightweight, distraction-free **Markdown text editor** designed for fluid, non-linear thinking. Built for developers, writers, and researchers, Voltaira strips away the bloat of traditional word processors, providing a fast, responsive, and connected workspace where ideas can be captured, tagged, and organized instantly.

[Live Demo](https://julienjave.github.io/voltaira-frontend/)


## Repository Ecosystem
This project is built using a completely decoupled, headless architecture. To review the complete system, explore both repositories:
- **Client Application (This Repo):** [https://github.com/julienjave/voltaira-frontend](https://github.com/julienjave/voltaira-frontend)
- **API Data Service (Backend):** [https://github.com/julienjave/voltaira-backend](https://github.com/julienjave/voltaira-backend)


## 1. Key Features

### Intelligent Workspace & Editing
- **Fluid Multi-View Workspace:** Full flexibility with three dedicated editing modes: Markdown-Only focus mode, Preview mode, or an interactive Side-by-Side Split View.
- **Rich Markdown Formatting Suite:** Built-in editing tools that dynamically inject syntax for text styling, layout formatting, and immediate insertion of structured elements like tables, links, and cross-origin media.
- **Frictionless Auto-Save:** A persistent client-side synchronization engine that continuously tracks editor state changes, eliminating manual saving and protecting content seamlessly.
- **Dynamic Table of Contents:** Active structural tracking that reads markdown headings in real time, auto-generating a responsive, clickable outline of your document.

### Non-Linear Organization & Networking
- **The Ghost Note System:** Allows conceptual outlining by letting you map out structural file references and empty note placeholders in your file explorer *before* creating the database documents. A note materializes persistently the moment content is introduced.
- **Bi-Directional Document Linking:** Tracks and resolves internal references between individual notes, laying down the groundwork for structured, non-linear knowledge graphs.
- **Visual Note Explorer:** A responsive sidebar interface built for rapid asset discovery, managing directory states and structural views efficiently.
- **Global Tagging Ecosystem:** An intuitive tagging layer used to categorize documentation organically across custom operational taxonomies.

### Document Portability
- **High-Fidelity Markdown Export:** One-click extraction pipeline that compiles and downloads workspace notes into raw, standard `.md` files for maximum portability.


## 2. Tech Stack & Core Architecture

**Frontend Core:**
- **Build Tool & Environment:** Vite (Optimized HMR and frontend asset bundling)
- **Core Scripting:** Vanilla JavaScript (ES6+) following an asynchronous, decoupled module pattern
- **Modular Component Architecture:** Native ES Modules (ESM) maximizing component reusability and explicit dependency trees without heavy framework overhead
- **Text Engine Subsystem:** CodeMirror 6 (A robust, extensible textual code surface providing optimized state management and layout event hooks)
- **Markdown Compilation:** Marked.js (A high-speed, lightweight Markdown-to-HTML parser)
- **Styling Architecture:** SASS / SCSS (Structured layout rules utilizing fluid custom property tokens, abstract mixins, and strict scope control)

**System Context:**
This repository operates strictly as a decoupled, standalone single-page application (SPA). It manages local state independently and communicates via asynchronous `fetch` operations exchanging structured JSON payloads with an isolated Express/Node.js RESTful API service.


## 3. Getting Started

Follow these steps to set up and run the Voltaira development interface locally.

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) (v16.x or higher) installed on your machine. You will also need the backend API service running simultaneously. 
> **Note:** Ensure you have configured and started the [Voltaira Backend Repository](https://github.com/your-username/voltaira-backend) before launching the frontend.

### 2. Clone the Repository
Clone the user interface repository and navigate into the project directory:
```bash
git clone [https://github.com/your-username/voltaira-frontend.git](https://github.com/your-username/voltaira-frontend.git)
cd voltaira-frontend
```

### 3. Install Dependencies
Install the required development dependencies (Vite, CodeMirror, Marked, SASS) managed by npm:
```bash
npm install
```

### 4. Environment Configuration
Create a .env file in the root of this frontend directory to point the client application to your local backend API server:
```javascript
VITE_BASE_URL = http://localhost:3000
```

### 5. Launch the Development Server
Spin up the Vite local environment with Hot Module Replacement (HMR):
```bash
npm run dev
```
Vite will host the client interface locally. Open your browser and navigate to the local URL provided in your terminal (typically `http://localhost:5173`).

### 6. Bridge: Connecting Backend to Frontend
To ensure seamless, cross-origin communication between your isolated frontend client and the database API, verify the following configuration parameters match across both workspaces:

1. **Port Synchronization:** Ensure the VITE_API_URL specified in your frontend .env matches the exact PORT configuration specified in your backend server variables.

2. **CORS Validation:** The backend API must be configured to accept cross-origin asynchronous fetch requests originating from your local Vite client origin server (e.g., `http://localhost:5173`).


## 4. Project Structure

The frontend client is architected around a decoupled, modular component design using native ES Modules to maintain a separation of concerns across styling, data fetching, templating, and view states.

```text
├── public/              # Static global assets (logos, fallback graphics)
├── src/
│   ├── services/        # API communication wrappers and external fetch utilities
│   ├── style/           # SASS/SCSS design modules, tokens, utilities, and mixins
│   ├── templates/       # Reusable HTML template elements and factory components
│   ├── views/           # UI Controller components managing active workspace panes
│   └── main.js          # Core application bootstrapper and event broker hub
├── .gitignore
├── index.html           # Single-page application root DOM anchor layout
├── package.json
└── vite.config.js       # Vite bundle optimization and sub-path deployment config
```

### Directory Breakdown
- `/services`: Handles the data abstraction layer. This folder contains modules dedicated to executing asynchronous fetch requests to your isolated backend API endpoints (e.g., handling note synchronization payloads, managing authentication session checks, and fetching tags).

- `/style`: Houses your centralized SASS/SCSS framework. It separates your code into abstract architecture blueprints (like fluid design token variables, dark/light theme properties, and standard utility mixins) ensuring strict layout scope control across your layout canvas.

- `/templates`: Contains reusable structural UI blueprints. These function as component factories—generating concrete, dynamic HTML layouts programmatically at runtime (such as rendering custom modal confirmation windows or dynamic dropdown menus).

- `/views`: Manages view state presentation logic. Each module inside this directory is responsible for controlling a distinct zone of the screen layout (such as the active text editor panel, the markdown preview viewer, or the sidebar file explorer tracking structural elements).


## 5. Technical Highlights

- **Optimized Event-Driven State Management:** To prevent chaotic prop-drilling and break tight UI coupling, the frontend leverages an isolated custom event-broker pattern. Component modules (like the Editor panel or Sidebar views) communicate asynchronously via decoupled pub/sub events. This significantly limits unnecessary DOM re-renders and handles view states cleanly.
- **The Ghost Note Architecture:** Implemented a lightweight virtual-file layout engine. This tracks non-persistent workspace references directly inside the DOM sidebar components, mapping operational IDs dynamically so users can structure complex node systems on the fly before committing data weight to the database.
- **Scalable SCSS Architecture & Utility Mixins:** Replaced repetitive styling sheets with an organized SASS mixin blueprint. By utilizing fluid design token mappings, the layout engine remains predictable, resilient against theme leaks, and easily maintainable.


## 6. Lessons Learned

- **Harnessing Heavy Third-Party Component Layers:** Integrating complex, event-heavy frameworks like CodeMirror 6 taught me how to manage deep internal libraries. I learned how to hook into proprietary component states and align them safely with custom layout wrappers.
- **The Imperative of Payload Contract Verification:** Working on a completely decoupled full-stack architecture reinforced the absolute necessity of rigorous API contract planning. I learned that knowing the exact layout, datatype, and structure of the returning database payload *before* constructing frontend views dramatically prevents layout rendering logic updates down the road.
- **DOM Engineering through Reusable Components:** Building features like our dynamic modal confirmation windows completely manually using Vanilla JS taught me the value of object-oriented UI design. Encapsulating layout rendering, backdrop tracking, and button hooks into singular, reusable factory structures keeps the root DOM lean and scalable.


## 7. Future Improvements

While Voltaira currently provides a highly optimized, responsive markdown editing environment, the application is architected to scale. The following high-impact modules are planned for upcoming development iterations:

### 1. Inline Live-Preview Mode (WYSIWYG)
- **Objective:** Transition the editor from a dual-pane split view to a unified, seamless live-rendering canvas (similar to Obsidian's modern engine). 
- **Technical Path:** Leverage CodeMirror 6's extensible decoration and widget extensions to parse and swap markdown tokens with styled HTML nodes instantly inline, hiding the raw syntax markers unless a line is actively being focused or edited.

### 2. Hierarchical Notebooks & Custom Folders
- **Objective:** Introduce a structural nesting layer on top of the organic global tagging ecosystem to allow users to build rigid, tree-structured folder taxonomies.
- **Technical Path:** Refactor the relational database schema to support recursive container entities. The UI Note Explorer panel will be updated to handle collapsible, deeply nested folder-tree layouts with seamless drag-and-drop node reordering.

### 3. WikiLinks Syntax Parsing
- **Objective:** Implement support for standard double-bracket internal link tokens (e.g., `[[Meeting Notes]]` or `[[Project Blueprint]]`) to form structural dependencies between nodes right from the text field.
- **Technical Path:** Write custom regular expression interceptors for the Marked.js compilation lifecycle to translate inner text matches into targeted application anchor element tags, seamlessly routing users to internal note IDs when clicked.

### 4. Interactive Knowledge Graph View
- **Objective:** Introduce a 2D interactive canvas viewport mapping out the visual layout network of a user's entire second brain workspace.
- **Technical Path:** Utilize a force-directed layout engine (such as D3.js or a lightweight HTML5 Canvas math model) to pull bi-directional note relationships from the database, rendering notes as interactive, physics-based nodes and internal links as connected edges.

### 5. Isolated Cross-Origin PDF Export Engine
- **Objective:** Expand the local document extraction pipeline to compile, scale, and save clean, high-contrast, physical print layouts into standard `.pdf` files.
- **Technical Path:** Resolve underlying browser canvas limitations and CORS network security walls by developing an insulated printing layer using explicit `@media print` layout overrides, ensuring remote media assets render with zero data inflation on the server tier.


## 8. License
This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

Copyright © 2026 Julien Javelaud. All rights reserved.


---
Built with ☕ and 💻 by Julien Javelaud

