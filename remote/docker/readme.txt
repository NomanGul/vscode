change dir to `vscode/remote/docker` and start with `sudo docker-compose up`

run code with `./scripts/code.sh ./remote/docker/test.code-workspace`

after changes to the docker file:
- build docker file with `sudo docker build -t docker-remote .`
- clear docker-compose cache with `sudo docker-compose rm -f`