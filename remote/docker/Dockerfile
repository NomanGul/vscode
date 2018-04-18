FROM node:8

# install some extensions in the container: git, css, typescript
RUN mkdir -p /root/.vscode-remote/extensions
# RUN ln -s /vscode/extensions/git /root/.vscode-remote/extensions/git
# RUN ln -s /vscode/extensions/css-language-features /root/.vscode-remote/extensions/css-language-features
# RUN ln -s /vscode/extensions/typescript-language-features /root/.vscode-remote/extensions/typescript-language-features
# RUN ln -s /vscode/.build/builtInExtensions/ms-vscode.node-debug /root/.vscode-remote/extensions/ms-vscode.node-debug
# RUN ln -s /vscode/.build/builtInExtensions/ms-vscode.node-debug2/ /root/.vscode-remote/extensions/ms-vscode.node-debug2

# create a folder with sample code in the container: /data/TypeScriptSamples
RUN mkdir /data
WORKDIR /data
RUN git clone https://github.com/Microsoft/vscode-smoketest-express
# RUN git clone https://github.com/Microsoft/TypeScriptSamples
# WORKDIR /data/TypeScriptSamples
# RUN echo "setInterval(function() {\n\tconsole.log('Hello');\n}, 1000);" > test.js

# run the agent: /vscode linked to the host's vscode folder (set up by docker-compose)
# CMD cd /vscode/remote && npm install . && cd /vscode && node out/remoteExtensionHostAgent.js && cd /data
CMD cd /vscode && ./scripts/remoteExtensionAgent.sh && cd /data
EXPOSE 8000
EXPOSE 8001
EXPOSE 3000