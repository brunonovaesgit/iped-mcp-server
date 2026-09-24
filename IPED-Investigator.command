#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '\nNode.js 20 ou superior não foi encontrado. Instale o Node.js e execute novamente.\n'
  printf 'Consulte o README para os requisitos.\n'
  printf '\nPressione Enter para fechar...'
  read _
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  printf '\nnpm não foi encontrado. Instale uma distribuição do Node.js que inclua npm.\n'
  printf '\nPressione Enter para fechar...'
  read _
  exit 1
fi
if [ ! -d node_modules ]; then
  printf '\nPreparando o IPED Investigator pela primeira vez...\n'
  npm install
fi
npm run launch
