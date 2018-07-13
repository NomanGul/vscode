FROM python:2.7

RUN mkdir /node
RUN wget -qO- https://nodejs.org/dist/v8.11.3/node-v8.11.3-linux-x64.tar.xz | tar xJv -C /node --strip-components 1
ENV PATH "/node/bin:$PATH"



# install some extensions in the container: git, css, typescript
#RUN mkdir -p /root/.vscode-remote/extensions
# RUN ln -s /vscode/extensions/git /root/.vscode-remote/extensions/git
# RUN ln -s /vscode/extensions/css-language-features /root/.vscode-remote/extensions/css-language-features
# RUN ln -s /vscode/extensions/typescript-language-features /root/.vscode-remote/extensions/typescript-language-features
# RUN ln -s /vscode/.build/builtInExtensions/ms-vscode.node-debug /root/.vscode-remote/extensions/ms-vscode.node-debug
# RUN ln -s /vscode/.build/builtInExtensions/ms-vscode.node-debug2/ /root/.vscode-remote/extensions/ms-vscode.node-debug2

# create a folder with sample code in the container: /data/TypeScriptSamples
#RUN mkdir /data
#WORKDIR /data
#RUN git clone https://github.com/Microsoft/vscode-smoketest-express

#CMD cd /vscode/remote && npm install &&


