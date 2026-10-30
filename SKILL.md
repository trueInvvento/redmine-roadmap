---
name: redmine-roadmap
description: Gera imagens PNG da timeline de roadmap de projetos Redmine ágeis (MVP, sprints e incrementos). Use quando pedirem roadmap, timeline de sprints, ou atualizar a imagem do roadmap. O usuário ajusta a chave e os projetos em roadmap.config.json antes de executar.
---

1. Ler roadmap.config.json na raiz do checkout. Se não existir, copiar o example e parar para o usuário preencher.
2. Não executar com chave vazia ou lista de projetos vazia.
3. Nunca imprimir, logar nem gravar a chave em HTML, PNG, markdown ou no relatório.
4. Rodar o script, que lê a config, chama a API e grava um PNG por projeto.
5. Devolver o caminho de cada PNG.

Se `apiKey` estiver vazio, o script usa `REDMINE_API_KEY` do `.env` na raiz do checkout. Não copie essa chave para o example nem para este arquivo.

O example está em `.cursor/skills/redmine-roadmap/roadmap.config.example.json`. Copie para `roadmap.config.json` na raiz. Rode a partir da raiz:

```bash
node .cursor/skills/redmine-roadmap/scripts/build-roadmaps.mjs
```

Cada projeto gera `output/roadmaps/<identifier>.png` e o HTML ao lado. Devolva o caminho absoluto de cada PNG.
