# Portal Web ESP8266 — Design Spec

**Data:** 2026-05-21  
**Hardware alvo:** Wemos D1 Mini (ESP8266)  
**Firmware base:** `firmware/rizom_temp_WEMOS_D1.ino` (v2.0)  
**Status:** Aprovado para implementação

---

## Visão geral

Substituir o portal de provisionamento atual (simples, somente para setup inicial) por um **portal web completo** acessível via IP do dispositivo na rede local. O portal é protegido por login customizado (usuário/senha) e oferece status em tempo real, configuração de rede WiFi, leitura de temperatura e configurações do dispositivo.

O fluxo de provisionamento existente (código de 6 dígitos → servidor `temp.rizom.com.br`) é **mantido sem alteração**. O portal não expõe nem permite editar credenciais MQTT manualmente.

---

## Decisões de design

| Decisão | Escolha | Motivo |
|---|---|---|
| Escopo | Portal completo sempre ativo | Paridade com mercado, valor para técnico instalador |
| Autenticação | Login page customizada | Visual profissional, alinhado com a marca |
| Armazenamento HTML | LittleFS (pasta `data/`) | HTML editável sem recompilar, separação clara |
| Estilo visual | Azul moderno (#2563EB) | Consistente com portal de provisioning atual |
| Provisionamento | Mantém código de 6 dígitos | Público não-técnico, controle centralizado no servidor |
| Sessão | Token aleatório em RAM + cookie | Simples, seguro o suficiente para rede local |

---

## Arquitetura

### Dois modos de operação

**Modo AP (não provisionado)**
- Rede WiFi: `RizomTemp-XXXXXX` (XXXXXX = últimos 3 bytes do MAC)
- IP: `192.168.4.1`
- Serve: somente tela de provisionamento (SSID + senha + código 6 dígitos)
- Comportamento idêntico ao atual — sem regressão

**Modo STA (provisionado)**
- Conectado ao WiFi do cliente, IP dinâmico via DHCP
- Serve: portal completo na porta 80
- Acessível por qualquer dispositivo na mesma rede local

### Estrutura de arquivos

```
firmware/
├── rizom_temp_WEMOS_D1.ino   ← código C++ (lógica + rotas)
└── data/                      ← pasta LittleFS (upload separado)
    ├── login.html
    ├── status.html
    ├── rede.html
    ├── temperatura.html
    ├── config.html
    └── style.css              ← CSS compartilhado entre todas as páginas
```

### Sessão e autenticação

- Credenciais padrão de fábrica: `admin` / `rizom`
- Usuário e senha armazenados na EEPROM (campos adicionados à struct `Config`)
- Login gera token aleatório de 32 chars hex (`String sessionToken` em RAM), gerado com `random()` semeado com MAC + `micros()` no `setup()`
- Token enviado como cookie `sid=<token>; HttpOnly; Path=/`
- Cada rota protegida verifica o cookie antes de servir — redireciona para `/login` se inválido
- Sessão única: novo login invalida a sessão anterior
- Sessão perdida no reboot (aceitável para uso em campo)

### Adições à struct Config (EEPROM)

```cpp
struct Config {
  // ... campos existentes ...
  char portalUser[32];   // padrão: "admin"
  char portalPass[32];   // padrão: "rizom"
  char deviceName[32];   // padrão: "RizomTemp"
};
```

O `EEPROM_MAGIC` deve ser alterado de `0xAB` para `0xAC` para forçar reset das configs na primeira gravação com a nova struct.  
O `EEPROM_SIZE` deve ser aumentado de `512` para `640` bytes para acomodar os 3 novos campos (3 × 32 = 96 bytes adicionais).  
Na primeira inicialização com a nova struct, `carregarConfig()` retornará `false` (magic diferente) e `portalUser`/`portalPass`/`deviceName` serão inicializados com os valores padrão.

### Rotas HTTP (modo STA)

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| GET | `/` | Redireciona para `/login` ou `/status` | — |
| GET | `/login` | Página de login (LittleFS) | — |
| POST | `/login` | Valida credenciais, define cookie, redireciona | — |
| GET | `/logout` | Limpa sessão, redireciona para `/login` | — |
| GET | `/status` | Página de status (LittleFS) | 🔒 |
| GET | `/api/status` | JSON: WiFi, MQTT, temperatura, uptime | 🔒 |
| GET | `/rede` | Página de rede (LittleFS) | 🔒 |
| GET | `/api/scan` | JSON: lista de SSIDs visíveis | 🔒 |
| POST | `/rede/salvar` | Salva SSID/senha na EEPROM, reinicia | 🔒 |
| GET | `/temperatura` | Página de temperatura (LittleFS) | 🔒 |
| GET | `/api/temp` | JSON: última leitura + histórico em RAM | 🔒 |
| GET | `/config` | Página de configurações (LittleFS) | 🔒 |
| GET | `/api/config` | JSON: config atual (sem senha) | 🔒 |
| POST | `/config/salvar` | Salva nome, intervalo, credenciais portal | 🔒 |

---

## Telas

### 1. Login (`/login`)
- Logo "Rizom**Temp**" (Temp em azul #2563EB)
- Subtitle: "Painel de configuração do dispositivo"
- Campos: Usuário, Senha
- Botão: ENTRAR
- Footer: "Wemos D1 Mini · Firmware v2.0"
- Sem menu de navegação (pré-autenticação)

### 2. Status (`/status`)
- Temperatura atual em destaque (fonte grande, azul)
- Legenda "Última leitura há Xs" (atualizada via `/api/status` a cada 10s)
- Card WiFi: Status, Rede (SSID), IP, RSSI, MAC
- Card MQTT: Status (Online/Offline), Broker, Device ID
- Card Sistema: Uptime, Intervalo de leitura

### 3. Rede (`/rede`)
- Campo SSID (editável, pré-preenchido com valor atual)
- Campo Senha (editável)
- Lista de redes encontradas (clicável — preenche o campo SSID automaticamente)
- Botão SALVAR E RECONECTAR (POST `/rede/salvar` → reboot)
- Botão ATUALIZAR LISTA (GET `/api/scan` → atualiza lista sem recarregar página)

### 4. Temperatura (`/temperatura`)
- Temperatura atual em destaque (atualiza a cada 5s via `/api/temp`)
- Histórico das últimas 20 leituras em memória RAM (timestamp + valor)
- Nota: "Leituras perdidas no reboot — dados históricos completos no dashboard"

### 5. Configurações (`/config`)
- Seção Dispositivo: Nome do dispositivo, Intervalo de leitura (segundos)
- Seção Acesso ao portal: Usuário, Nova senha (campo vazio = mantém atual)
- Seção Provisionamento: exibe Device ID atual (somente leitura) + instrução para reprovisionar via botão físico
- Botão SALVAR (POST `/config/salvar`)
- Botão REINICIAR DISPOSITIVO (soft reboot)
- Botão RESET DE FÁBRICA (apaga EEPROM + reboot → volta ao modo AP)

---

## Navegação

Barra de navegação superior presente em todas as telas autenticadas:
- Topbar: logo "RizomTemp" à esquerda + link "sair" à direita
- Nav: abas Status | Rede | Temp | Config (aba ativa destacada)

---

## Histórico de temperatura em RAM

```cpp
struct Leitura {
  unsigned long ts;  // millis()
  float temp;
};
Leitura historico[20];
int histIdx = 0;
```

A cada leitura bem-sucedida, armazena no array circular. `/api/temp` retorna o array como JSON. Limitado a 20 entradas para não estressar a SRAM do ESP8266 (80KB total).

---

## PlatformIO — configuração para LittleFS + ESP8266

O `platformio.ini` atual aponta para ESP32-C3. Para o Wemos D1 Mini, adicionar (ou criar) um environment ESP8266:

```ini
[env:d1_mini]
platform = espressif8266
board = d1_mini
framework = arduino
board_build.filesystem = littlefs
monitor_speed = 115200
upload_speed = 921600
lib_deps =
  PubSubClient @ ^2.8
  OneWire @ ^2.3.4
  DallasTemperature @ ^3.9.7
```

LittleFS é nativo no ESP8266 Arduino core 3.x — `#include <LittleFS.h>` sem biblioteca extra.

Upload em dois passos:
1. **Upload Firmware** — `pio run -e d1_mini -t upload`
2. **Upload Filesystem** — `pio run -e d1_mini -t uploadfs`

---

## Fora do escopo

- Configuração manual de MQTT (host, porta, device ID) — gerenciado pelo servidor de provisioning
- Download/export de dados locais — dados históricos ficam no servidor (Raspberry Pi)
- IP estático configurável pelo portal (pode ser adicionado depois)
- HTTPS — sem certificado local; aceitável para rede local privada
- Múltiplas sessões simultâneas

---

## Critérios de aceite

1. Em modo AP: portal de provisionamento funciona igual ao atual (sem regressão)
2. Em modo STA: portal acessível via IP do dispositivo na rede local sem configuração adicional
3. Login com credenciais erradas retorna erro na mesma página (sem recarregar)
4. Trocar WiFi pela tela Rede reconecta o dispositivo e mantém as outras configs
5. Reset de fábrica apaga tudo e o dispositivo volta ao modo AP
6. Temperatura na tela Temp atualiza automaticamente sem o usuário recarregar a página
7. Credenciais do portal são persistidas na EEPROM e sobrevivem ao reboot
