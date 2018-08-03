# A packaged version of remote extension host will be found in /out
FROM ubuntu:bionic as builder

# Install dependencies
RUN apt-get update && apt-get install -y git curl nodejs npm python gnupg libx11-dev libxkbfile-dev libsecret-1-dev
RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
RUN echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
RUN apt-get update && apt-get install -y yarn
RUN npm install npm@latest -g
RUN npm install pkg -g

# Add source code (You can modify this to point to a different branch/commit if needed)
ARG GH_TOKEN
# Checkout to a specific commit so future changes don't accidentally break this.
RUN git clone -b remote-hackathon https://$GH_TOKEN@github.com/Microsoft/vscode-remote /vscode-remote \
    && cd /vscode-remote \
	&& git reset --hard b3de762227e8b1f52eafb91e60dcf6cdf2d97e10
ADD pkg-package.json /vscode-remote/pkg-package.json

# Build remote extension host
WORKDIR /vscode-remote
RUN yarn install && yarn run compile
RUN node /vscode-remote/build/lib/builtInExtensions.js
# Install vscode-ripgrep so search in VS Code can work.
RUN cd /vscode-remote/remote && npm install && npm install vscode-ripgrep
RUN mkdir /out

# Workaround 1: Patch this file by removing the line that matches the pattern. It causes a module not found error
RUN sed -i '/--inspect=0.0.0.0:/d' /vscode-remote/out/vs/workbench/node/remoteExtensionHostServer.js
# Workaround 2: Patch node-pty library file to find pty.node in same directory as the executable package
RUN sed -i "/require(path.join('..', 'build', 'Release', 'pty.node')/c\var pty = require(path.join(path.dirname(process.execPath), 'pty.node'));" /vscode-remote/node_modules/node-pty/lib/unixTerminal.js
# Workaround 3: Patch to get ripgrep to work for VS Code search
RUN sed -i "/var rgDiskPath/c\var rgDiskPath = path.join(path.dirname(process.execPath), 'rg');" /vscode-remote/extensions/search-rg/out/ripgrepTextSearch.js
RUN sed -i "/var rgDiskPath/c\var path = require('path'); var rgDiskPath = path.join(path.dirname(process.execPath), 'rg');" /vscode-remote/extensions/search-rg/out/ripgrepFileSearch.js

# Copy pty.node as it can't be included in the executable package. See https://github.com/zeit/pkg#native-addons
RUN cp /vscode-remote/remote/node_modules/node-pty/build/Release/pty.node /out/pty.node
# Copy rg binary as it can't be included in the executable package. See https://github.com/zeit/pkg#native-addons
RUN cp /vscode-remote/remote/node_modules/vscode-ripgrep/bin/rg /out/rg
# Build the executable package
RUN pkg -t node8-linux-x64 -d -c /vscode-remote/pkg-package.json -o /out/vscode-reh /vscode-remote/out/remoteExtensionHostAgent.js

# Copy the build assets (vscode-reh, pty.node, rg) to separate stage of build that is *much* smaller.
# It also proves that we don't need any of the build assets any longer.
FROM ubuntu:bionic
WORKDIR /out
COPY --from=0 /out .
# Install git so the git VS Code extension works
RUN apt-get update && apt-get install -y git
CMD ["/out/vscode-reh", "--builtin-extensions=extension-editing,configuration-editing,search-rg,css-language-features,git,grunt,gulp,html-language-features,json-language-features,markdown-language-features,npm,php-language-features,typescript-language-features"]
