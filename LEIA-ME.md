# SyncWatch

Assista o mesmo vídeo com seu amigo, no mesmo segundo: Netflix, Prime Video, Disney+, HBO Max, Globoplay, Crunchyroll e YouTube.

Cada um assiste na própria conta. O vídeo não passa pelo servidor, só os comandos (play, pause, posição). Por isso a qualidade é a original de cada um e o consumo de internet extra é quase zero.

```
app/          App de desktop (recomendado) — navegador próprio com Widevine
server/       Servidor das salas + site para YouTube no navegador
extension/    Extensão do Chrome (opcional, versão antiga)
render.yaml   Hospedagem gratuita do servidor com link fixo
```

---

## Parte 1 — Servidor com link fixo (uma vez só)

O servidor é o "lugar" onde a sala existe. Hospedando ele na internet, o endereço nunca muda e ninguém precisa deixar janela aberta.

1. Crie uma conta no **GitHub** (github.com) e um repositório novo, por exemplo `syncwatch`. Pode ser privado.
2. Envie a pasta inteira do projeto para ele. O jeito mais fácil é o **GitHub Desktop**, ou arrastar os arquivos na página do repositório.
3. Crie uma conta no **Render** (render.com) entrando com o GitHub.
4. No Render: **New → Blueprint**, escolha o repositório e confirme. Ele lê o `render.yaml` sozinho.
5. Em uns 2 minutos aparece o endereço, algo como `https://syncwatch-abcd.onrender.com`. **Esse é o seu servidor para sempre.**

> O plano gratuito "dorme" depois de ~15 minutos sem ninguém. Na primeira conexão do dia, o app pode levar até 1 minuto para conectar, porque o servidor está acordando. Depois disso fica normal.

**Sem querer hospedar?** Dá para continuar usando o servidor no seu PC com o túnel: `iniciar.bat` + `iniciar-tunel.bat`. A diferença é que o link muda toda vez.

---

## Parte 2 — App de desktop (só você faz, uma vez)

Precisa de **Node.js** (`winget install OpenJS.NodeJS.LTS`). O resto o script instala.

1. Abra a pasta `app` e dê dois cliques em **`1-configurar.bat`**. Ele:
   - instala o app (baixa o Electron da castlabs, que tem o Widevine);
   - instala o Python, se faltar (aí ele pede para rodar o `.bat` de novo);
   - cria sua **conta EVS gratuita** da castlabs. Ele pergunta nome de conta, e-mail e senha, e chega um código no seu e-mail;
   - **assina** o app, o que faz Netflix/Prime/Disney+ aceitarem tocar.
2. Dê dois cliques em **`2-abrir-app.bat`** para testar.
3. Quando estiver tudo certo, rode **`3-gerar-instalador.bat`**. Ele cria um `SyncWatch Setup x.x.x.exe` na pasta `app\dist`, já assinado.
4. **Mande esse `.exe` para o seu amigo.** Ele só instala, sem conta EVS e sem Node.

> Na primeira vez que alguém abre o instalador, o Windows pode mostrar "O Windows protegeu o computador", porque o app não tem certificado pago da Microsoft. Clique em **Mais informações → Executar assim mesmo**.

---

## Parte 3 — Usando

1. Abra o app e clique no serviço (Netflix, Prime...). Entre na sua conta. **O login fica salvo.**
2. Na barra da direita, preencha **nome**, **servidor** (o endereço do Render) e **sala**, e clique em **Entrar**.
3. Clique em **Copiar convite** e mande para o amigo. Ele abre o link, clica em **Abrir no app** e já cai na sala.
4. Abram o mesmo filme ou episódio e deem play. Pronto.

O que o app faz sozinho:
- **Play, pause e pulos** de qualquer um aparecem para o outro.
- Se alguém estiver em outro episódio, aparece **"Ir para o vídeo da sala"**.
- A barra mostra quantos **milissegundos** cada um está do ponto certo.
- **Tela cheia** funciona normalmente (botão do próprio player).
- O botão ▯ no canto superior direito esconde a barra da sala.

---

## Como a sincronização funciona

1. **Relógio comum:** cada um mede o atraso até o servidor e calcula a hora do servidor com precisão de milissegundos.
2. **Estado da sala:** quando alguém dá play, pausa ou pula, o servidor registra "no instante X, o vídeo estava no segundo Y".
3. **Correção contínua**, a cada 0,4 s:
   - mais de 1 s de diferença → pula direto;
   - diferença pequena → acelera ou desacelera de leve (até 1,1x/0,9x) até alcançar, sem pulo visível.

Nos testes, dois players ficaram a **15–30 ms** um do outro.

---

## Problemas comuns

| Problema | Solução |
|---|---|
| Netflix/Prime: tela preta ou erro de reprodução | A assinatura EVS não pegou. Rode `py -m castlabs_evs.account reauth` e depois `npm run assinar-dev` dentro de `app` (ou gere o instalador de novo). |
| "Widevine indisponível" na tela inicial | Na primeira abertura o Widevine é baixado. Feche e abra o app de novo com internet. |
| Qualidade mais baixa que no app oficial | É o limite dos streamings para navegadores (normalmente 720p–1080p). |
| Algum serviço bloqueou o app | Os streamings podem mudar regras. Me conta o código do erro. |
| "Clique no vídeo para liberar" | Clique uma vez no player. |
| App não conecta na primeira vez do dia | O servidor do Render está acordando. Espere ~1 minuto. |
| Convite não abre o app | O app precisa estar instalado pelo `.exe` (o `2-abrir-app.bat` não registra o link). |

---

## Para desenvolvedores

- `app/main.js`: janela, navegador do streaming (`WebContentsView`, sessão `persist:streaming`), tela cheia, links `syncwatch://`.
- `app/src/stream/stream-sync.js`: roda dentro da página do streaming, acha o `<video>` e sincroniza.
- `app/src/stream/netflix-bridge.js`: pula o tempo na Netflix pela API do player dela.
- `app/src/ui/`: interface (abas, sala, membros, chat).
- `server/public/sync-engine.js`: motor de sincronização. **É a fonte única:** o `npm start`/`npm run dist` copia ele para o app; para a extensão, copie à mão.
- Testes: `cd server && npm test`.
