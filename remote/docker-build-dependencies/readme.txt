sudo docker build -t build-wsl-deps .
sudo docker run -v ~/workspaces/vscode:/vscode --name=f123 build-wsl-deps /bin/bash /vscode/remote/docker-build-dependencies/build.sh
sudo docker rm f123