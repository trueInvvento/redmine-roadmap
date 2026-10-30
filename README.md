# redmine-roadmap

Gera um PNG da timeline inteira de cada projeto Redmine ágil. A imagem reúne MVP, sprints e incremento.

A skill fica em `.cursor/skills/redmine-roadmap/`.

## Configuração

Copie o example para `roadmap.config.json` na raiz do checkout:

`.cursor/skills/redmine-roadmap/roadmap.config.example.json` → `roadmap.config.json`

Preencha antes de executar:

- `projects`: lista de identificadores dos projetos.
- `baseUrl`: URL base do Redmine.
- `outputDir`: pasta dos arquivos gerados. No example, `output/roadmaps`.
- `apiKey`: chave da API. Se ficar vazia, o script usa `REDMINE_API_KEY` do `.env` na raiz do checkout.

O script para se a chave estiver vazia ou se `projects` estiver vazio. Não grave a chave no example nem neste README.

`roadmap.config.json` e `.env` não entram no git.

## Comando

Na raiz do checkout:

```bash
node .cursor/skills/redmine-roadmap/scripts/build-roadmaps.mjs
```

## Saída

Cada identificador em `projects` gera:

- `output/roadmaps/<identifier>.png` — PNG da timeline inteira
- `output/roadmaps/<identifier>.html` — HTML ao lado do PNG
