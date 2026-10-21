# ACP Control

Mobiles Web-Interface zum Steuern mehrerer KI-Coding-Agenten aus einem
GitHub Codespace – ohne Terminal. Die Agenten werden über das
[Agent Client Protocol](https://agentclientprotocol.com) (ACP) angebunden,
also über denselben stdio/JSON-RPC-Weg, den auch Editoren wie Zed nutzen.

Auf der Oberfläche wählt man den Agenten aus, chattet mit ihm, bestätigt
Datei- und Befehlsfreigaben und meldet sich bei Bedarf direkt im Browser an.

## Ablauf

```
Handy-Browser  →  ACP Control (Node-Server)  →  ACP-Agent (stdio)  →  Modell
```

Der Server startet den jeweiligen Agenten als Kindprozess und übersetzt
zwischen WebSocket (Browser) und ACP (Agent).

## Unterstützte Agenten

| Agent | Login | Kosten |
| --- | --- | --- |
| **Codex** (`@agentclientprotocol/codex-acp`) | ChatGPT-Geräte-Code (`codex login --device-auth`) | kostenloses ChatGPT-Kontingent, kein API-Key |
| **Antigravity** (`agy_acp_server`) | Google-Login (OAuth) | kostenlos, kein API-Key |
| **GitHub Copilot** (optional) | GitHub-Geräte-Login | erfordert Copilot-Abo |

Es werden ausschließlich kostenlose Login-Wege genutzt; API-Key-Verfahren
werden in der Oberfläche bewusst ausgeblendet.

## Schnellstart im Codespace

Beim Öffnen des Codespaces läuft automatisch
`acp-control/scripts/codespace-start.sh` (siehe `.devcontainer/devcontainer.json`):

1. Abhängigkeiten werden installiert, falls nötig.
2. Port `12000` wird öffentlich geschaltet, damit die Seite auch vom Handy
   erreichbar ist.
3. Der Server startet im Hintergrund.
4. Der Browser öffnet die passende Codespaces-URL automatisch.

Die URL wird aus `CODESPACE_NAME` und `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`
gebildet – sie muss also nirgends manuell eingetragen werden, auch wenn
Codespaces bei jedem Start eine andere Adresse erzeugt.

Fehlende Agenten lassen sich über `ACP_AUTO_INSTALL=1` automatisch
nachinstallieren oder einzeln über den Knopf „Agent installieren“.

## Lokal starten

```bash
cd acp-control
npm install
npm start          # http://localhost:12000
```

Umgebungsvariablen:

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `12000` | HTTP-/WebSocket-Port |
| `HOST` | `0.0.0.0` | Bind-Adresse |
| `ACP_WORKSPACE` | Repo-Wurzel | Arbeitsverzeichnis der Agenten |
| `ACP_AGENTS_CONFIG` | `agents.json` | Agenten-Konfiguration |
| `ACP_PORT` | `12000` | Port für das Startskript |
| `ACP_AUTO_INSTALL` | `0` | Agenten beim Start installieren |

## Agenten installieren

```bash
cd acp-control
npm run install-agents
```

Das Skript installiert `codex-acp`, optional die Copilot-CLI sowie `agy` samt
offiziellem ACP-Server aus der ACP-Registry. Die großen Binärdateien landen in
`agents/` und sind von der Versionierung ausgenommen.

## Anmeldung ohne API-Key

**Codex (Geräte-Code).** Der Agent bietet den Login `ChatGPT (device code)` an,
sobald der Client URL-Elicitation unterstützt. Die Oberfläche zeigt Code und
Verifizierungs-URL an (`https://chatgpt.com/device`); nach der Bestätigung im
ChatGPT-Konto baut der Server die Session auf. Voraussetzung ist, dass die
Geräte-Anmeldung im ChatGPT-Konto freigeschaltet ist.

**Antigravity (Google-OAuth).** Der Google-Login verwendet einen Loopback-
Rückruf (`http://127.0.0.1:PORT/`), der vom Handy aus nicht erreichbar ist.
Deshalb zeigt die Oberfläche die Login-URL an und nimmt anschließend die
Loopback-Adresse aus der Adressleiste entgegen. Der Server reicht sie über
`POST /api/oauth/forward` an den wartenden Login-Prozess im Codespace weiter.
Aus Sicherheitsgründen werden nur Loopback-Ziele akzeptiert.

## HTTP-Endpunkte

| Methode | Pfad | Zweck |
| --- | --- | --- |
| `GET` | `/api/agents` | Agentenliste inkl. Verfügbarkeit |
| `POST` | `/api/agents/:id/install` | Agent installieren |
| `POST` | `/api/oauth/forward` | Loopback-Rückruf an wartenden Login weiterreichen |

WebSocket: `/acp-ws` für Chat/Session, `/terminal-ws` für das Login-Terminal.

## Tests

```bash
cd acp-control
npm test
```

Abgedeckt sind Agentenliste, ein kompletter Prompt-Durchlauf inklusive
Freigabe, der Anmeldeablauf nach `authRequired`, der Geräte-Code-Login über
URL-Elicitation und die Loopback-Beschränkung des OAuth-Weiterleiters.
