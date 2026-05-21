# Rizom Temp — Documento de Produto

## O que é

Rizom Temp é um sistema completo de **monitoramento automático de temperatura** para câmaras frias, freezers, refrigeradores e expositores — desenvolvido para atender às exigências da **ANVISA RDC 216/2004** (Boas Práticas para Serviços de Alimentação).

O sistema registra temperatura 24 horas por dia, gera alertas em tempo real quando algo sai do limite e emite relatórios mensais de conformidade com um clique.

---

## Problema que resolve

Restaurantes, padarias, supermercados, redes de fast food e qualquer estabelecimento que manipule alimentos são obrigados pela ANVISA a **manter registros de temperatura** de equipamentos de frio. Hoje, a maioria faz isso com:

- Termômetros manuais e anotação em papel (sujeito a esquecimento e fraude)
- Planilhas preenchidas manualmente (trabalhoso e impreciso)
- Fiscalizações que podem resultar em multa ou interdição quando os registros estão incompletos

O Rizom Temp elimina o processo manual e garante conformidade contínua e auditável.

---

## Como funciona

```
Sensor DS18B20 → ESP-01 (Wi-Fi) → MQTT → Raspberry Pi → Dashboard Web
```

1. **Sensor físico** (DS18B20) instalado dentro do equipamento de frio mede a temperatura a cada 60 segundos
2. **Módulo Wi-Fi** (ESP-01, menor que um pendrive) transmite os dados via protocolo MQTT
3. **Servidor local** (Raspberry Pi Zero 2W instalado no estabelecimento) recebe, armazena e processa os dados em banco PostgreSQL
4. **Dashboard web** acessível de qualquer lugar via HTTPS mostra temperatura atual, histórico e alertas
5. **Acesso remoto seguro** via Cloudflare Tunnel — sem necessidade de IP fixo ou abertura de portas no roteador

---

## Funcionalidades

### Monitoramento em tempo real
- Temperatura atual de todos os equipamentos em um único painel
- Status visual: dentro do limite (verde), atenção (amarelo), fora do limite (vermelho)
- Última leitura com timestamp
- Histórico gráfico por período

### Alertas automáticos
- Disparo de alerta quando temperatura ultrapassa ou cai abaixo dos limites configurados
- Tolerância configurável (ex: só alerta se fora do limite por mais de 10 minutos)
- Integração com webhook para notificações via **WhatsApp, Telegram ou e-mail** (via n8n)
- Painel de alertas com histórico e reconhecimento

### Relatórios ANVISA
- Relatório mensal em PDF gerado automaticamente
- Inclui: média, mínima, máxima, total de leituras, leituras fora do limite e **% de conformidade**
- Cabeçalho com nome da empresa e CNPJ
- Menção explícita à norma ANVISA RDC 216/2004
- Exportação por equipamento ou geral

### Gestão de equipamentos
- Cadastro de múltiplos equipamentos por estabelecimento
- Tipos pré-configurados com limites ANVISA: câmara fria, freezer, refrigerador, expositor frio, expositor quente
- Limites personalizáveis por equipamento
- Device ID único gerado automaticamente para cada sensor

### Controle de acesso
- Múltiplos usuários por cliente
- Perfis: **Admin** (acesso total), **Operador** (visualização + reconhecimento de alertas), **Visualizador** (somente leitura)
- Autenticação JWT segura

---

## Arquitetura técnica

| Componente | Tecnologia |
|---|---|
| Sensor | DS18B20 (precisão ±0.5°C) |
| Dispositivo IoT | ESP-01 (ESP8266) |
| Protocolo de comunicação | MQTT (Mosquitto) |
| Servidor local | Raspberry Pi Zero 2W |
| Backend | Node.js + Express |
| Banco de dados | PostgreSQL |
| Frontend | React 19 + Vite |
| Acesso remoto | Cloudflare Tunnel (HTTPS automático, sem IP fixo) |

---

## Limites ANVISA pré-configurados

| Tipo de equipamento | Mínimo | Máximo | Norma |
|---|---|---|---|
| Câmara fria | -18°C | -15°C | RDC 216/2004 |
| Freezer | -18°C | -10°C | RDC 216/2004 |
| Refrigerador | 0°C | 5°C | RDC 216/2004 |
| Expositor frio | 0°C | 10°C | RDC 216/2004 |
| Expositor quente | 60°C | — | RDC 216/2004 |

Todos os limites são personalizáveis por equipamento.

---

## Diferenciais competitivos

- **Funciona sem internet**: o Raspberry Pi local continua gravando dados mesmo sem conexão. Quando a internet volta, o acesso remoto é reestabelecido automaticamente
- **Sem mensalidade de nuvem**: infraestrutura 100% no próprio estabelecimento do cliente
- **Instalação simples**: script automatizado instala tudo em menos de 10 minutos
- **Hardware acessível**: ESP-01 custa menos de R$15, Raspberry Pi Zero 2W custa ~R$150
- **Sensor confiável**: DS18B20 é o sensor de temperatura mais usado em aplicações industriais e food safety
- **Acesso de qualquer lugar**: dashboard acessível pelo celular, tablet ou computador via link HTTPS
- **Open source**: código auditável, sem vendor lock-in

---

## Público-alvo

- Restaurantes e lanchonetes com câmaras frias
- Padarias e confeitarias
- Supermercados e mercadinhos
- Redes de fast food
- Cozinhas industriais e catering
- Hotéis e resorts com serviço de alimentação
- Distribuidoras de alimentos

Qualquer estabelecimento sujeito à fiscalização ANVISA que precise de **registro automático e auditável de temperatura**.

---

## Proposta de valor

> "Esqueça a planilha. Esqueça o termômetro manual. O Rizom Temp registra tudo automaticamente, avisa quando algo sai do limite e entrega o relatório ANVISA pronto para assinar."

**Benefícios diretos:**
- Elimina multas e autuações por falta de registro de temperatura
- Reduz desperdício de alimentos com alertas precoces de falha de refrigeração
- Economiza tempo da equipe com registros manuais
- Facilita auditorias com relatórios prontos em PDF
- Funciona 24/7 sem intervenção humana

---

## Modelo de entrega

O sistema é entregue como solução completa:

1. **Hardware**: kit com Raspberry Pi Zero 2W configurado + ESP-01(s) com firmware gravado
2. **Instalação**: script automatizado ou instalação assistida no local
3. **Acesso**: dashboard personalizado com domínio do cliente
4. **Suporte**: configuração de alertas e treinamento de uso

---

## Stack e integrações

- **Notificações**: webhook compatível com n8n, Zapier, Make — envia alertas para WhatsApp Business, Telegram, e-mail ou qualquer sistema
- **Relatórios**: PDF gerado no servidor, pronto para impressão ou envio por e-mail
- **API REST**: backend documentado, integrável com sistemas de gestão (ERP, etc.)
- **Multi-cliente**: arquitetura pronta para atender múltiplos estabelecimentos em uma única instância
