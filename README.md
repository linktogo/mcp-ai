# LK-AI — serveur d'agents (MCP)

LK-AI est une plateforme d'agents construite autour du Model Context Protocol (MCP). Elle charge dynamiquement des "prompts" (fichiers Markdown) et des ressources, et expose des transports STDIO (pour l'inspector / CLI) et HTTP SSE (Server-Sent Events) pour l'intégration en temps réel.

Ce README a été mis à jour pour décrire les nouvelles commandes et la possibilité de publier les prompts comme une bibliothèque npm.

## Points clés
- Chargement dynamique de prompts locaux (`data/prompts/`) et distants (dépôts Git listés dans `config/prompts_sources.json`).
- Export automatique des ressources (`.md`, `.txt`, `.json`) en prompts optionnellement.
- Deux points d'entrée : `mcp_server.js` (STDIO) et `sse_server.js` (HTTP SSE).
- Script `scripts/publish_prompts.js` pour construire et publier une librairie npm contenant tous les prompts (locaux + distants).

---

## Prérequis

- Node.js 18+ et npm  
- Git (pour cloner/puller les prompts distants)

## Installation

```zsh
git clone https://github.com/linktogo/mcp-ai.git
cd lk_ai
npm install
```

## Scripts utiles (dans `package.json`)

- `npm start` — démarre le serveur MCP en STDIO (utilisable par l'inspector).  
- `npm run sse` — démarre le serveur SSE (port par défaut 4000).  
- `npm run sse:dev` — démarre SSE sur le port 4000 (convention dev).  
- `npm run inspector` — lance l'inspector MCP (wrapper stable).  
- `npm run inspector:sse` — lance SSE + inspector en parallèle (via `concurrently`).  
- `npm run build:prompts` — construit le package de prompts dans `dist/<pkg>/` (ne publie pas).  
- `npm run publish:prompts` — construit puis publie le package (exécute `npm publish` dans `dist/`).

Exemple : build local sans publier

```zsh
npm run build:prompts
# ou en simulation
DRY_RUN=1 npm run publish:prompts
```

Pour publier réellement : assurez-vous d'être connecté à npm (`npm login`) et d'avoir les droits sur le nom de package souhaité. Vous pouvez surcharger le nom/version/visibilité via les variables d'environnement :

- `PROMPTS_PACKAGE_NAME` (ex: `@scope/lk-ai-prompts`)  
- `PROMPTS_PACKAGE_VERSION` (ex: `1.2.3`)  
- `NPM_PUBLISH_ACCESS` (ex: `public`)

Exemple de publication :

```zsh
PROMPTS_PACKAGE_NAME=@linktogo/lk-ai-prompts PROMPTS_PACKAGE_VERSION=0.1.0 NPM_PUBLISH_ACCESS=public npm run publish:prompts
```

Le package généré contient le dossier `data/` avec tous les prompts et un `index.js` ESM qui exporte un mapping { <chemin_sans_.md>: contenu }.

### Importer la librairie de prompts

Après publication, vous pouvez l'installer et l'importer :

```js
import prompts, { getPrompt, listPrompts } from '@linktogo/lk-ai-prompts';
console.log(listPrompts());
console.log(getPrompt('chatmodes/my_prompt'));
```

Le module exporte par défaut un objet mappant les chemins relatifs dans `data/` vers le texte Markdown.

---

## Lancer les serveurs

STDIO (inspector / CLI) :

```zsh
npm start
```

SSE (HTTP) :

```zsh
npm run sse
# ou pour dev explicitement sur le port 4000
npm run sse:dev
```

SSE + inspector en parallèle :

```zsh
npm run inspector:sse
```

## Endpoints SSE & REST

- `GET /events` — souscription SSE (envoie des événements du serveur)  
- `GET /list_dynamic_prompts` — liste les prompts chargés  
- `GET /list_resources` — liste les ressources  
- `POST /reload_prompts` — force le rechargement des prompts (local + distants)  
- `POST /reload_resources` — rechargement des ressources  
- `POST /tool/:name` — invoque un outil programmatique (body JSON avec paramètres)

Remarque : certains endpoints peuvent être protégés par authentification (voir ci-dessous).

---

## Configuration des prompts distants

Déposez un fichier `config/prompts_sources.json` au format JSON. Chaque entrée peut être une chaîne (URL) ou un objet :

```json
[
  {
    "repo": "https://github.com/your-org/prompts-repo.git",
    "name": "team-prompts",
    "branch": "main",
    "prefix": "team"
  }
]
```

Le script de build copie les dossiers `data/chatmodes`, `data/prompts`, `data/collections`, `data/remote_prompts` et clone/pull les dépôts listés dans `config/prompts_sources.json` sous `dist/<pkg>/data/remote_prompts/`.

---

## Authentification (optionnelle)

L'API SSE et les endpoints HTTP peuvent être protégés. L'auth peut être désactivée via un flag CLI lors du démarrage (option `--no-auth` / `--disable-auth` dans les wrappers) — utile en local.

Modes supportés :

- `static` : utiliser `AUTH_TOKEN` (valeur simple attendue dans l'en-tête `Authorization: Bearer <token>`).  
- `jwt` : utiliser `AUTH_TYPE=jwt` et définir `JWT_SECRET` pour vérifier des JWTs HS256. Vous pouvez régler `AUTH_LEEWAY` (secondes) pour tolérance d'horloge.

Variables d'environnement utiles :

- `AUTH_TYPE` — `static` ou `jwt` (si non défini et `AUTH_TOKEN` présent, `static` est utilisé)  
- `AUTH_TOKEN` — token statique  
- `JWT_SECRET` — secret pour vérifier JWT HS256  
- `AUTH_LEEWAY` — tolérance en secondes pour la vérification JWT

Exemples :

```zsh
AUTH_TOKEN=mysupersecrettoken npm run sse
# ou JWT
AUTH_TYPE=jwt JWT_SECRET=your_secret npm run sse
```

Lorsque l'auth est activée, incluez un header `Authorization: Bearer <token-or-jwt>` dans vos requêtes HTTP.

---

## Dépannage rapide

- Si les clones Git échouent, vérifiez l'URL, la branche et les accès (SSH/HTTPS tokens).  
- Si des prompts ne s'affichent pas, vérifiez `data/` et lancez `reload_prompts` via l'inspector ou l'endpoint HTTP.

---

## Contribuer

1. Ajouter des prompts locaux dans `data/prompts/*.md`.  
2. Ajouter/mettre à jour des sources distantes dans `config/prompts_sources.json`.  
3. Exécuter `npm run build:prompts` pour vérifier le package résultant.  
4. Soumettre une PR.

## Licence

Voir le fichier `LICENSE`.

## Architecture

**MCP App Factory** (`lib/mcp_app.js`):
- Creates a shared MCP server instance with all tools registered.
- Returns `{ server, invokeTool, ... }` for programmatic use.
- Used by both `mcp_server.js` (STDIO) and `sse_server.js` (HTTP).

**Prompt Loader** (`lib/prompts.js`):
- Scans `data/prompts/` and applies `prefixLocal`.
- Clones/pulls remote Git repos from `config/prompts_sources.json`.
- Supports per-source `prefix` to namespace imports.

**Resource Loader** (`lib/resources.js`):
- Scans `data/resources/` for auxiliary files.
- Auto-exports as MCP prompts (toggle via env).

**Tools Exposed:**
- `list_dynamic_prompts` – List all loaded prompts.
- `reload_prompts` – Reload local + remote prompts.
- `list_resources` – List all resources.
- `reload_resources` – Reload resources and re-export as prompts.
- `get_resource` – Fetch a specific resource content.
- `getApiKey` – Get API_KEY from environment.

## Environment Variables

- `PROMPTS_DIR` – Override local prompts directory (default: `data/prompts`).
- `PROMPTS_LOCAL_PREFIX` – Prefix to apply to local prompts (overrides config).
- `RESOURCES_DIR` – Override resources directory (default: `data/resources`).
- `EXPORT_RESOURCES_AS_PROMPTS` – Auto-export resources as prompts (default: `"true"`).
- `SSE_PORT` – SSE server listen port (default: `4000`).
- `API_KEY` – Exposed via `getApiKey` tool.
 - `AUTH_TYPE` – `static` or `jwt`. If omitted and `AUTH_TOKEN` is set, `static` is used.
 - `AUTH_TOKEN` – Static token value (used when `AUTH_TYPE=static`).
 - `JWT_SECRET` – Secret used to verify HS256 JWTs when `AUTH_TYPE=jwt`.
 - `AUTH_LEEWAY` – Optional clock leeway in seconds for JWT verification (default 0).
 - `PROMPTS_DIR` – Override local prompts directory (default: `data/prompts`).
 - `PROMPTS_LOCAL_PREFIX` – Prefix to apply to local prompts (overrides config).
 - `RESOURCES_DIR` – Override resources directory (default: `data/resources`).
 - `EXPORT_RESOURCES_AS_PROMPTS` – Auto-export resources as prompts (default: `"true"`).
 - `SSE_PORT` – SSE server listen port (default: `4000`).
 - `API_KEY` – Exposed via `getApiKey` tool.

## Troubleshooting

### Remote Git repos fail to clone
- Verify URL and branch exist.
- For private repos, configure SSH keys (`~/.ssh/config`) or HTTPS token auth.

### Prompts not showing up
- Check `data/prompts/` contains `.md` files.
- Verify `config/prompts_sources.json` is valid JSON.
- Run `reload_prompts` tool to trigger discovery.

### Prefix collisions
- Use unique `prefix` values in each `config/prompts_sources.json` entry.
- Check via `list_dynamic_prompts` to see actual names.

## Contributing

1. Add local prompts to `data/prompts/*.md`.
2. Configure remote sources in `config/prompts_sources.json`.
3. Adjust prefix settings in `config/prompts_config.json`.
4. Reload via the inspector or SSE endpoints.

## License

See LICENSE file.