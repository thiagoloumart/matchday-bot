# ⚽ matchday-bot

**O seu time no grupo de WhatsApp.** Gols, cartões e resultado ao vivo, tabela, próximo jogo e as notícias do dia, postados sozinhos, com voz de torcedor. Qualquer time, em português ou inglês.

[🇬🇧 Read in English](README.md)

```
🥅 O LEÃO ABRIU O PLACAR!

Fortaleza 1 x 0 Náutico

⚽ Lucero, 23'
```

Está no ar desde junho de 2026 num grupo de torcedores do Fortaleza: **534 mensagens** até agora, sendo **92** de bom dia.

## O que o grupo recebe

| Quando | Mensagem |
|---|---|
| Toda manhã | Bom dia + jogo de hoje (ou o próximo) + posição na tabela + 3 manchetes |
| Tarde e noite | Giro de notícias (pulado durante jogo) + boa noite |
| 15 min antes do jogo | "É dia de Leão!" com campeonato, estádio, horário e placar da ida |
| Ao vivo | Início, cada gol (com emoção: *empate*, *virada*), cartões, VAR, pênalti perdido, intervalo, prorrogação, pênaltis |
| Fim de jogo | Vitória / empate / derrota, depois a tabela atualizada e o próximo jogo |
| Diário | Boas-vindas a quem entrou (numa mensagem só, todos marcados) + convite para compartilhar o grupo |

Os horários são sorteados dentro de uma janela a cada dia, para não parecer robô.

## Configure em 2 minutos

```bash
git clone https://github.com/thiagoloumart/matchday-bot && cd matchday-bot
npm install
npm run setup
```

O assistente pergunta:

1. **Idioma**: português ou inglês.
2. **Time**: você escolhe a liga (Brasileirão A/B/C, Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, MLS…), digita o nome e ele acha o time na ESPN. Também sugere as copas para acompanhar.
3. **Jeito da torcida**: apelido ("GOOOOL DO *LEÃO*!"), como chamar a torcida, emoji, cores, grito de guerra.
4. **O seu WhatsApp**, pela sua [Evolution API](https://github.com/EvolutionAPI/evolution-api):
   - testa a URL e a chave, e se a instância está **conectada**;
   - **lista os grupos** em que o número do bot está, e você só escolhe (sem caçar ID de grupo);
   - confere se o bot **está no grupo** e **pode postar**. Se só admins enviam e o bot não é admin, ele para e diz o que ajustar;
   - pega o **link de convite** sozinho quando o bot é admin;
   - manda uma **mensagem de teste** para o seu número.
5. **Opcional**: uma página de notícias do time e um resumo do dia escrito por IA.

Tudo fica salvo no `.env` (só você lê) com `DRY_RUN=true`. Depois:

```bash
npm run demo    # todas as mensagens, com o seu time
npm run once    # 1 ciclo de verdade, só no log
# gostou? DRY_RUN=false no .env
npm start       # ou: pm2 start ecosystem.config.js
```

## Como funciona

- **Dados grátis, sem chave**: API pública da ESPN e RSS do Google Notícias.
- **Nunca manda repetido**: cada lance tem uma chave no SQLite, então reiniciar não repete gol.
- **Consulta inteligente**: a cada 15 s durante o jogo, a cada 15 min fora dele.
- **Não posta no lugar errado**: uma trava só libera o grupo configurado (e o seu número, para testes).
- **Avisa quando fica cego**: se a ESPN parar de responder por cerca de 1 hora, você recebe um aviso no privado, e outro quando ela volta. Isso veio de um caso real: a fonte bloqueou o bot por 5 horas e ninguém percebeu.
- `tools/wa-msg.js` lista as últimas mensagens e apaga uma para todos se algo sair errado.

Todas as opções estão no [`.env.example`](.env.example): competições (`LEAGUES`), busca das notícias (`NEWS_QUERY`), janelas de horário, quais lances avisar, página e resumo por IA.

**Só futebol.** A ESPN tem outros esportes, mas os lances (gol, cartão, pênalti) são próprios do futebol.

**Tecnologia:** Node.js 20+ (`fetch` nativo), SQLite (`better-sqlite3`), Evolution API para o WhatsApp. Sem framework.

## Como foi feito

IA-nativo: escrevi a especificação a partir do dia a dia de um grupo de torcedores de verdade, orientei agentes de código a construir e transformei o bot do meu time num modelo que qualquer um roda.

---

Thiago Lourenço Martins · [LinkedIn](https://www.linkedin.com/in/thiago-lourenco-martins) · [loumart.com.br](https://loumart.com.br)
