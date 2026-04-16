# Provisionamento de Dispositivo via Código — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o ESP32-C3 seja configurado digitando apenas Wi-Fi + um código de 6 dígitos gerado pelo dashboard, eliminando a necessidade de copiar device_id e dados MQTT manualmente.

**Architecture:** O dashboard gera um código temporário (6 dígitos, 10 min, uso único) vinculado ao equipamento. O ESP32 conecta no Wi-Fi, chama `GET /provisioning/:codigo` (endpoint público), recebe device_id + config MQTT e salva no NVS. O dashboard exibe fluxo guiado após criar/acessar equipamento.

**Tech Stack:** Node.js/Express, PostgreSQL, React 19 + TypeScript, C++ Arduino (ESP32-C3), Axios

---

## Mapa de arquivos

| Arquivo | Ação | O que muda |
|---|---|---|
| `backend/src/migrations/003_codigos_pareamento.sql` | Criar | Nova tabela `codigos_pareamento` |
| `backend/src/routes/provisioning.js` | Criar | Endpoints `/equipamentos/:id/pareamento` e `/provisioning/:codigo` |
| `backend/src/index.js` | Modificar | Registrar rota `/provisioning` |
| `backend/src/routes/equipamentos.js` | Modificar | Adicionar `POST /:id/pareamento` |
| `backend/.env` | Modificar | Adicionar `MQTT_HOST_LOCAL=192.168.1.212` |
| `frontend/src/api.ts` | Modificar | Adicionar `gerarCodigo()` em `equipamentosApi` |
| `frontend/src/pages/Equipamentos.tsx` | Modificar | Modal com passo 2 de configuração + countdown |
| `frontend/src/pages/EquipamentoDetalhe.tsx` | Modificar | Botão "Configurar dispositivo" + modal |
| `firmware/rizom_temp_esp32c3_v2.ino` | Modificar | Portal simplificado + chamada de provisionamento |

---

## Task 1: Migration — tabela `codigos_pareamento`

**Files:**
- Create: `backend/src/migrations/003_codigos_pareamento.sql`

- [ ] **Step 1: Criar o arquivo SQL**

```sql
-- backend/src/migrations/003_codigos_pareamento.sql
CREATE TABLE IF NOT EXISTS codigos_pareamento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipamento_id UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  codigo         CHAR(6) NOT NULL,
  expira_em      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  usado          BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_codigos_pareamento_codigo
  ON codigos_pareamento (codigo)
  WHERE usado = FALSE;
```

- [ ] **Step 2: Rodar a migration no Pi**

No Pi (`ssh pi@192.168.1.212`, senha `rizomtag123`):
```bash
cd /opt/rizomtemp/backend
DATABASE_URL="postgresql://rizomtemp:Fish!703@localhost:5432/rizomtemp" node src/migrations/run.js
```

Saída esperada:
```
[Migration] Encontradas 3 migration(s)
[Migration] Executando 003_codigos_pareamento.sql...
[Migration] ✓ 003_codigos_pareamento.sql
[Migration] Concluído.
```

- [ ] **Step 3: Verificar tabela criada**

No Pi:
```bash
sudo -u postgres psql -d rizomtemp -c "\d codigos_pareamento"
```

Deve mostrar as colunas: id, equipamento_id, codigo, expira_em, usado, criado_em.

- [ ] **Step 4: Commit**

```bash
git add backend/src/migrations/003_codigos_pareamento.sql
git commit -m "feat: add codigos_pareamento migration"
```

---

## Task 2: Backend — rotas de provisionamento

**Files:**
- Create: `backend/src/routes/provisioning.js`
- Modify: `backend/src/routes/equipamentos.js` (adicionar endpoint de geração de código)
- Modify: `backend/src/index.js` (registrar rota `/provisioning`)
- Modify: `backend/.env` (nova variável)

- [ ] **Step 1: Adicionar `MQTT_HOST_LOCAL` no `.env` do Pi**

No Pi:
```bash
echo "MQTT_HOST_LOCAL=192.168.1.212" >> /opt/rizomtemp/.env
```

Verificar:
```bash
grep MQTT_HOST_LOCAL /opt/rizomtemp/.env
```

Saída esperada: `MQTT_HOST_LOCAL=192.168.1.212`

- [ ] **Step 2: Criar `backend/src/routes/provisioning.js`**

```js
// src/routes/provisioning.js
const express = require('express');
const db = require('../db');
const { autenticar, exigirPerfil } = require('../middleware/auth');

const router = express.Router();

// POST /equipamentos/:id/pareamento — gera código (autenticado)
// Registrado em equipamentos.js mas definido aqui para separar responsabilidades
// Exportado como função para ser chamado do router de equipamentos

// GET /provisioning/:codigo — endpoint público para o ESP32 buscar config
router.get('/:codigo', async (req, res) => {
  const { codigo } = req.params;

  if (!/^\d{6}$/.test(codigo)) {
    return res.status(400).json({ erro: 'Código inválido' });
  }

  const { rows } = await db.query(
    `SELECT cp.equipamento_id, e.device_id, e.temp_min, e.temp_max
     FROM codigos_pareamento cp
     JOIN equipamentos e ON e.id = cp.equipamento_id
     WHERE cp.codigo = $1
       AND cp.usado = FALSE
       AND cp.expira_em > NOW()`,
    [codigo]
  );

  if (rows.length === 0) {
    return res.status(404).json({ erro: 'Código inválido ou expirado' });
  }

  const equip = rows[0];

  // Marca como usado
  await db.query(
    `UPDATE codigos_pareamento SET usado = TRUE WHERE codigo = $1`,
    [codigo]
  );

  res.json({
    device_id:    equip.device_id,
    mqtt_host:    process.env.MQTT_HOST_LOCAL || process.env.MQTT_HOST || 'localhost',
    mqtt_port:    parseInt(process.env.MQTT_PORT || '1883'),
    intervalo_seg: 60,
  });
});

module.exports = router;
```

- [ ] **Step 3: Adicionar endpoint de geração de código em `backend/src/routes/equipamentos.js`**

Adicionar após o último `router.get` existente (antes de `module.exports`):

```js
// POST /equipamentos/:id/pareamento — gera código de 6 dígitos para provisioning
router.post('/:id/pareamento', autenticar, exigirPerfil('admin', 'operador'), async (req, res) => {
  const { id } = req.params;

  // Verifica que o equipamento pertence ao cliente
  const { rows: equips } = await db.query(
    `SELECT id FROM equipamentos WHERE id = $1 AND cliente_id = $2 AND ativo = true`,
    [id, req.usuario.cliente_id]
  );
  if (equips.length === 0) {
    return res.status(404).json({ erro: 'Equipamento não encontrado' });
  }

  // Invalida códigos anteriores não usados do mesmo equipamento
  await db.query(
    `UPDATE codigos_pareamento SET usado = TRUE
     WHERE equipamento_id = $1 AND usado = FALSE`,
    [id]
  );

  // Gera código único de 6 dígitos
  let codigo;
  let tentativas = 0;
  do {
    codigo = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const { rows } = await db.query(
      `SELECT 1 FROM codigos_pareamento WHERE codigo = $1 AND usado = FALSE`,
      [codigo]
    );
    if (rows.length === 0) break;
    tentativas++;
  } while (tentativas < 10);

  const { rows } = await db.query(
    `INSERT INTO codigos_pareamento (equipamento_id, codigo)
     VALUES ($1, $2)
     RETURNING codigo, expira_em`,
    [id, codigo]
  );

  res.json({ codigo: rows[0].codigo, expira_em: rows[0].expira_em });
});
```

- [ ] **Step 4: Registrar rota em `backend/src/index.js`**

Adicionar após os outros `require` de rotas (linha ~17):
```js
const provisioningRoutes = require('./routes/provisioning');
```

Adicionar após `app.use('/relatorios', relatoriosRoutes)` (linha ~49):
```js
app.use('/provisioning', provisioningRoutes);
```

- [ ] **Step 5: Testar os endpoints localmente no Pi**

Reiniciar o serviço no Pi:
```bash
sudo systemctl restart rizomtemp-backend
sleep 3
sudo systemctl status rizomtemp-backend | grep Active
```

Pegar token de admin:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","senha":"senha123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo $TOKEN
```

Pegar ID de um equipamento:
```bash
curl -s http://localhost:3000/equipamentos \
  -H "Authorization: Bearer $TOKEN" | grep -o '"id":"[^"]*"' | head -1
```

Gerar código (substitua `EQUIP_ID` pelo id obtido):
```bash
curl -s -X POST http://localhost:3000/equipamentos/EQUIP_ID/pareamento \
  -H "Authorization: Bearer $TOKEN"
```

Saída esperada: `{"codigo":"482951","expira_em":"2026-04-15T..."}`

Usar o código no endpoint público:
```bash
curl -s http://localhost:3000/provisioning/482951
```

Saída esperada:
```json
{"device_id":"esp01_XXXXXXXX","mqtt_host":"192.168.1.212","mqtt_port":1883,"intervalo_seg":60}
```

Testar código inválido:
```bash
curl -s http://localhost:3000/provisioning/000000
```
Saída esperada: `{"erro":"Código inválido ou expirado"}`

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/provisioning.js backend/src/routes/equipamentos.js backend/src/index.js
git commit -m "feat(backend): add device provisioning endpoints with 6-digit pairing code"
```

---

## Task 3: Frontend — fluxo guiado de configuração

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/pages/Equipamentos.tsx`
- Modify: `frontend/src/pages/EquipamentoDetalhe.tsx`

- [ ] **Step 1: Adicionar `gerarCodigo` em `frontend/src/api.ts`**

Adicionar interface e método em `equipamentosApi`:

```ts
export interface CodigoPareamento {
  codigo: string;
  expira_em: string;
}
```

Adicionar dentro de `equipamentosApi` (após `configDispositivo`):
```ts
gerarCodigo: (id: string) =>
  api.post<CodigoPareamento>(`/equipamentos/${id}/pareamento`),
```

- [ ] **Step 2: Criar componente `ModalConfigurarDispositivo` inline em `Equipamentos.tsx`**

Adicionar import no topo:
```ts
import { equipamentosApi } from '../api';
import type { Equipamento, CodigoPareamento } from '../api';
import { Wifi, Copy, RefreshCw, CheckCircle } from 'lucide-react';
```

Adicionar novo componente antes de `export default function Equipamentos()`:

```tsx
function ModalConfigurarDispositivo({
  equipamentoId,
  onFechar,
}: {
  equipamentoId: string;
  onFechar: () => void;
}) {
  const [par, setPar] = useState<CodigoPareamento | null>(null);
  const [loading, setLoading] = useState(true);
  const [segundosRestantes, setSegundosRestantes] = useState(600);
  const [copiado, setCopiado] = useState(false);

  async function gerarCodigo() {
    setLoading(true);
    try {
      const { data } = await equipamentosApi.gerarCodigo(equipamentoId);
      setPar(data);
      const expiresAt = new Date(data.expira_em).getTime();
      setSegundosRestantes(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { gerarCodigo(); }, []);

  useEffect(() => {
    if (segundosRestantes <= 0) return;
    const timer = setInterval(() => setSegundosRestantes(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [segundosRestantes]);

  function copiar() {
    if (!par) return;
    navigator.clipboard.writeText(par.codigo);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const minutos = String(Math.floor(segundosRestantes / 60)).padStart(2, '0');
  const segundos = String(segundosRestantes % 60).padStart(2, '0');
  const expirado = segundosRestantes === 0;

  const passos = [
    'Ligue o ESP32-C3 — LED piscará rápido',
    'Conecte seu celular no Wi-Fi "RizomTemp-XXXXXX"',
    'Acesse 192.168.4.1 no navegador',
    'Digite sua senha Wi-Fi e o código abaixo',
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }} onClick={onFechar}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20, padding: 28, width: 440,
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'Syne', fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wifi size={18} /> Configurar dispositivo
          </h3>
          <button onClick={onFechar} style={{ background: 'none', color: 'var(--text-muted)', fontSize: 20 }}>×</button>
        </div>

        {/* Passos */}
        <div style={{ marginBottom: 20 }}>
          {passos.map((passo, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', background: 'var(--rizom-blue)',
                color: 'white', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{i + 1}</div>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{passo}</span>
            </div>
          ))}
        </div>

        {/* Código */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
            Gerando código...
          </div>
        ) : (
          <>
            <div style={{
              background: 'var(--surface-2)', border: `2px solid ${expirado ? '#ef4444' : 'var(--rizom-blue)'}`,
              borderRadius: 16, padding: '20px', textAlign: 'center', marginBottom: 12,
            }}>
              <div style={{
                fontSize: 48, fontWeight: 800, letterSpacing: 12,
                fontFamily: 'monospace', color: expirado ? '#ef4444' : 'var(--text-primary)',
                marginBottom: 8,
              }}>
                {par?.codigo.split('').join(' ')}
              </div>
              <div style={{ fontSize: 12, color: expirado ? '#ef4444' : 'var(--text-muted)' }}>
                {expirado ? 'Código expirado' : `expira em ${minutos}:${segundos}`}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <button
                onClick={copiar}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                  background: copiado ? 'rgba(5,150,105,0.1)' : 'var(--surface-2)',
                  border: `1px solid ${copiado ? '#059669' : 'var(--border)'}`,
                  color: copiado ? '#059669' : 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {copiado ? <><CheckCircle size={14} /> Copiado!</> : <><Copy size={14} /> Copiar código</>}
              </button>
              <button
                onClick={gerarCodigo}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <RefreshCw size={14} /> Gerar novo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Integrar `ModalConfigurarDispositivo` no fluxo de criação em `Equipamentos.tsx`**

Adicionar estado:
```tsx
const [equipCriado, setEquipCriado] = useState<string | null>(null);
```

Modificar a função `criar` para abrir o modal de configuração após criar:
```tsx
async function criar() {
  if (!form.nome) return;
  setSalvando(true);
  try {
    const { data } = await equipamentosApi.criar(form as Partial<Equipamento>);
    setShowModal(false);
    setForm({ nome: '', tipo: 'refrigerador', localizacao: '' });
    setEquipCriado(data.id);
    carregar();
  } finally {
    setSalvando(false);
  }
}
```

Adicionar o modal de configuração no JSX (antes do `</div>` final do return):
```tsx
{equipCriado && (
  <ModalConfigurarDispositivo
    equipamentoId={equipCriado}
    onFechar={() => setEquipCriado(null)}
  />
)}
```

- [ ] **Step 4: Adicionar botão "Configurar dispositivo" em `EquipamentoDetalhe.tsx`**

Adicionar import:
```tsx
import { Wifi } from 'lucide-react';
import { ModalConfigurarDispositivo } from './Equipamentos'; // não funciona — componente não exportado
```

**Nota:** O componente `ModalConfigurarDispositivo` precisa ser extraído para um arquivo próprio para ser reutilizado. Mover para `frontend/src/components/ModalConfigurarDispositivo.tsx` e exportar como default. Atualizar o import em `Equipamentos.tsx`:
```tsx
import ModalConfigurarDispositivo from '../components/ModalConfigurarDispositivo';
```

Criar `frontend/src/components/ModalConfigurarDispositivo.tsx` com o código completo do componente do Step 2 (com `export default function ModalConfigurarDispositivo`).

Em `EquipamentoDetalhe.tsx`, adicionar estado e botão:
```tsx
const [showConfigurar, setShowConfigurar] = useState(false);
```

No cabeçalho do detalhe (próximo ao botão de refresh), adicionar:
```tsx
<button
  onClick={() => setShowConfigurar(true)}
  style={{
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 10, fontSize: 13,
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
  }}
>
  <Wifi size={14} /> Configurar dispositivo
</button>
```

E no JSX:
```tsx
{showConfigurar && equip && (
  <ModalConfigurarDispositivo
    equipamentoId={equip.id}
    onFechar={() => setShowConfigurar(false)}
  />
)}
```

- [ ] **Step 5: Build e deploy no Pi**

No Mac:
```bash
cd /Users/lucas/Downloads/rizom-temp/frontend
npm run build
scp -r dist/ pi@192.168.1.212:/tmp/dist_novo/
```

No Pi:
```bash
sudo rm -rf /opt/rizomtemp/frontend/dist
sudo cp -r /tmp/dist_novo /opt/rizomtemp/frontend/dist
sudo chown -R rizomtemp:rizomtemp /opt/rizomtemp/frontend/dist
rm -rf /tmp/dist_novo
```

- [ ] **Step 6: Testar no browser**

1. Acesse `https://temp.rizomtag.com.br`
2. Equipamentos → Adicionar equipamento → preencha e crie
3. Modal de configuração deve abrir com código de 6 dígitos e countdown
4. Equipamentos → clique em um equipamento existente → botão "Configurar dispositivo" deve aparecer

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.ts frontend/src/pages/Equipamentos.tsx frontend/src/pages/EquipamentoDetalhe.tsx frontend/src/components/ModalConfigurarDispositivo.tsx
git commit -m "feat(frontend): add device pairing flow with 6-digit code and countdown"
```

---

## Task 4: Firmware — portal simplificado + provisionamento

**Files:**
- Modify: `firmware/rizom_temp_esp32c3_v2.ino`

> **Contexto:** O firmware usa `Preferences` (NVS) para salvar config. Tem um captive portal com WebServer na porta 80. Após salvar, conecta Wi-Fi e tenta MQTT. Vamos adicionar o estado `PROVISIONANDO` entre conectar Wi-Fi e operar.

- [ ] **Step 1: Adicionar biblioteca HTTPClient**

No Arduino IDE: não precisa instalar — `HTTPClient` já vem com o core ESP32. Adicionar o include no topo do arquivo:

```cpp
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
```

- [ ] **Step 2: Adicionar constante e campo de config**

Após os `#define` existentes:
```cpp
// URL base do backend para provisionamento
#define PROVISIONING_URL "https://temp.rizomtag.com.br/provisioning/"
```

Adicionar campo `codigo` na struct `Config`:
```cpp
struct Config {
  char wifiSSID[64]     = "";
  char wifiSenha[64]    = "";
  char mqttHost[128]    = "";
  int  mqttPort         = 1883;
  char mqttUser[64]     = "";
  char mqttSenha[64]    = "";
  char deviceId[32]     = "";
  int  intervaloSeg     = 60;
  char codigo[7]        = "";   // ← novo: código temporário de provisionamento
} cfg;
```

- [ ] **Step 3: Salvar e carregar `codigo` no NVS**

Em `salvarConfig()`, adicionar:
```cpp
prefs.putString("codigo", cfg.codigo);
```

Em `carregarConfig()`, adicionar:
```cpp
prefs.getString("codigo", "").toCharArray(cfg.codigo, sizeof(cfg.codigo));
```

- [ ] **Step 4: Simplificar o HTML do portal**

Substituir `PORTAL_HTML` pelo novo HTML com apenas 3 campos:

```cpp
const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rizom Temp — Configuração</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0D1526;color:#EDF2FF;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#111827;border:1px solid rgba(26,110,255,.2);border-radius:20px;padding:28px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.logo{font-size:20px;font-weight:800;margin-bottom:6px}
.logo span{color:#4F8EF7}
.sub{font-size:13px;color:#6B7A9F;margin-bottom:24px}
.group{margin-bottom:16px}
label{display:block;font-size:11px;color:#6B7A9F;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.8px}
input{width:100%;padding:12px 14px;background:#1a2235;border:1px solid rgba(255,255,255,.08);border-radius:10px;color:#EDF2FF;font-size:15px;outline:none;transition:border-color .2s}
input:focus{border-color:#1A6EFF}
input[name=codigo]{font-size:22px;font-weight:800;letter-spacing:6px;text-align:center;font-family:monospace}
.btn{width:100%;padding:14px;background:#1A6EFF;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px}
.btn:hover{opacity:.85}
.ok{display:none;background:rgba(5,150,105,.1);border:1px solid rgba(5,150,105,.3);border-radius:12px;padding:16px;text-align:center;color:#059669;font-size:14px;margin-top:16px}
.note{font-size:11px;color:#2A3354;text-align:center;margin-top:14px;line-height:1.6}
</style></head><body>
<div class="card">
  <div class="logo">Rizom<span>Temp</span></div>
  <div class="sub">Configure o dispositivo em 3 passos</div>
  <form id="f">
    <div class="group">
      <label>Nome da rede Wi-Fi</label>
      <input name="ssid" placeholder="MinhaRede" required autocomplete="off">
    </div>
    <div class="group">
      <label>Senha do Wi-Fi</label>
      <input name="pass" type="password" placeholder="••••••••">
    </div>
    <div class="group">
      <label>Código do dashboard</label>
      <input name="codigo" placeholder="000000" maxlength="6" pattern="\d{6}" required inputmode="numeric">
    </div>
    <button class="btn" type="submit">Conectar</button>
  </form>
  <div class="ok" id="ok">✓ Conectando e buscando configuração...</div>
  <p class="note">Rizom Temp v2.0 · ESP32-C3<br>Segure BOOT 5s para redefinir</p>
</div>
<script>
document.getElementById('f').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const d=Object.fromEntries(new FormData(e.target));
  const r=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
  if(r.ok){document.getElementById('f').style.opacity='.3';document.getElementById('ok').style.display='block';}
});
</script>
</body></html>
)rawliteral";
```

- [ ] **Step 5: Atualizar handler `/save` do portal**

No handler `portalServer.on("/save", ...)`, substituir o preenchimento de config:

```cpp
strlcpy(cfg.wifiSSID,  doc["ssid"]   | "", sizeof(cfg.wifiSSID));
strlcpy(cfg.wifiSenha, doc["pass"]   | "", sizeof(cfg.wifiSenha));
strlcpy(cfg.codigo,    doc["codigo"] | "", sizeof(cfg.codigo));
// Limpa campos que serão preenchidos pelo provisionamento
cfg.mqttHost[0]  = '\0';
cfg.deviceId[0]  = '\0';
cfg.mqttPort     = 1883;
cfg.intervaloSeg = 60;
```

- [ ] **Step 6: Adicionar estado `PROVISIONANDO` e enum**

Modificar o enum:
```cpp
enum Estado { PORTAL, CONECTANDO, PROVISIONANDO, OPERANDO, ERRO };
```

- [ ] **Step 7: Adicionar tela OLED de provisionamento**

```cpp
void telaProvisionando() {
  oledLimpar();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);   oled.print("PROVISIONANDO");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 18);  oled.print("Buscando config");
  oled.setCursor(0, 28);  oled.print("no servidor...");
  oledAtualizar();
}
```

- [ ] **Step 8: Implementar função `buscarConfigRemota()`**

```cpp
bool buscarConfigRemota() {
  if (strlen(cfg.codigo) != 6) {
    Serial.println("[Prov] Código ausente ou inválido.");
    return false;
  }

  telaProvisionando();

  WiFiClientSecure secureClient;
  secureClient.setInsecure(); // aceita qualquer certificado (simplificado)
  HTTPClient http;

  String url = String(PROVISIONING_URL) + String(cfg.codigo);
  Serial.printf("[Prov] GET %s\n", url.c_str());

  http.begin(secureClient, url);
  http.setTimeout(10000);
  int httpCode = http.GET();

  Serial.printf("[Prov] HTTP %d\n", httpCode);

  if (httpCode != 200) {
    Serial.printf("[Prov] Falha: HTTP %d\n", httpCode);
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.println("[Prov] JSON inválido.");
    return false;
  }

  strlcpy(cfg.deviceId,  doc["device_id"] | "", sizeof(cfg.deviceId));
  strlcpy(cfg.mqttHost,  doc["mqtt_host"] | "", sizeof(cfg.mqttHost));
  cfg.mqttPort     = doc["mqtt_port"]     | 1883;
  cfg.intervaloSeg = doc["intervalo_seg"] | 60;
  cfg.codigo[0]    = '\0'; // limpa código após uso

  if (strlen(cfg.deviceId) == 0 || strlen(cfg.mqttHost) == 0) {
    Serial.println("[Prov] Config incompleta recebida.");
    return false;
  }

  salvarConfig();
  Serial.printf("[Prov] OK — device_id: %s | mqtt: %s:%d\n",
    cfg.deviceId, cfg.mqttHost, cfg.mqttPort);
  return true;
}
```

- [ ] **Step 9: Atualizar o `loop()` para o novo estado**

No bloco `CONECTANDO`, substituir:
```cpp
if (estado == CONECTANDO) {
  ledBlink(500);
  if (conectarWifi()) {
    // Se tem código pendente → provisionar; senão → operar direto
    if (strlen(cfg.codigo) == 6) {
      estado = PROVISIONANDO;
    } else {
      estado = OPERANDO;
    }
  } else {
    Serial.println("[WiFi] Não conseguiu conectar. Abrindo portal...");
    iniciarPortal();
  }
  return;
}
```

Adicionar bloco `PROVISIONANDO` após `CONECTANDO`:
```cpp
if (estado == PROVISIONANDO) {
  ledBlink(300);
  if (buscarConfigRemota()) {
    // Sucesso: mostra confirmação e reinicia
    oledLimpar();
    oled.setTextSize(1);
    oled.setTextColor(SSD1306_WHITE);
    oled.setCursor(16, 20); oled.print("Config recebida!");
    oled.setCursor(28, 36); oled.print("Reiniciando...");
    oledAtualizar();
    delay(2000);
    ESP.restart();
  } else {
    // Falha: abre portal novamente
    telaErro("Codigo invalido\nou expirado.\nAbrindo portal...");
    delay(3000);
    iniciarPortal();
  }
  return;
}
```

- [ ] **Step 10: Compilar e gravar no ESP32-C3**

No Arduino IDE:
- Placa: `ESP32C3 Dev Module`
- USB CDC On Boot: `Enabled`
- Compile (Ctrl+R) — deve compilar sem erros
- Upload (Ctrl+U)

- [ ] **Step 11: Testar o fluxo completo**

1. Ligar o ESP32-C3 → OLED mostra "CONFIGURACAO" + nome do AP
2. Conectar no Wi-Fi `RizomTemp-XXXXXX`
3. Abrir `192.168.4.1` — portal com 3 campos
4. No dashboard, criar equipamento → copiar o código de 6 dígitos
5. Preencher: rede Wi-Fi, senha, código → Conectar
6. OLED: "PROVISIONANDO → Buscando config..."
7. OLED: "Config recebida! Reiniciando..."
8. ESP32 reinicia → OLED mostra temperatura
9. Dashboard começa a receber leituras

- [ ] **Step 12: Commit**

```bash
git add firmware/rizom_temp_esp32c3_v2.ino
git commit -m "feat(firmware): simplify portal to 3 fields with provisioning code flow"
```

---

## Verificação final

Após todos os tasks, testar o fluxo de ponta a ponta:

```
Dashboard → Novo equipamento → Código exibido (ex: 482951, timer 10min)
ESP32 AP → portal 3 campos → preenche Wi-Fi + 482951
ESP32 → GET https://temp.rizomtag.com.br/provisioning/482951
Backend → retorna device_id + mqtt_host + porta → código marcado como usado
ESP32 → reinicia → publica temperatura a cada 60s
Dashboard → leituras chegando no equipamento correto
Código 482951 → segunda tentativa → HTTP 404 (uso único confirmado)
```
