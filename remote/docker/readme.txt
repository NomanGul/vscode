change dir to `vscode/remote/docker` and start with `docker-compose up`

run code with `./scripts/code.sh ./remote/docker/test.code-workspace`

after changes to the docker file:
- `docker-compose rm -f` && `docker-compose up --build`

open container shell:
`docker exec -ti docker_docker-remote_1 /bin/bash`