
### Build binaries

The below steps build a container image for remote extension host as a binary into the `/out` directory in the resulting image.

There will be 3 files in `/out`:
1. `vscode-reh` - The remote extension host binary
2. `pty.node` - An auxillary binary file required by `node-pty`
3. `rg` - An auxillary binary file required by `vscode-ripgrep`

We cannot currently package `pty.node` and `rg` into the `vscode-reh` binary due to https://github.com/zeit/pkg#native-addons.

```bash
# Change directory into this one.
cd vscode-remote/remote/docker-host-package

# Run the build while specifying your GitHub auth token for cloning the repo.
docker build --build-arg GH_TOKEN=YOUR_TOKEN .

# The build will output an image with an image ID.

# Run the container with this image to run the remote extension host.
docker run -d -p 8000:8000 IMAGE_ID

# View logs from the container.
docker logs -f CONTAINER_ID
```

Now to connect to it with the VS Code client create a workspace file like this:
```json
# test.code-workspace
{
    "folders": [{
        "uri": "vscode-remote://127.0.0.1:8000/root",
        "name": "my-remote"
    }],
	"settings": {
    	"searchRipgrep.enable": true
	}
}
```

```bash
./scripts/code.sh test.code-workspace
```

Once VS Code starts, you can clone a repo as git is included in the image using the integrated terminal (e.g. `git clone https://github.com/h5bp/html5-boilerplate`) then explore the files.

### Extract binaries from the build container
From the container build, the 3 files you need to extract are `vscode-reh`, `pty.node` and `rg`.
Copy these from the container to your host and you should be able to include it on other Linux-based (not alpine) containers.
e.g.
```
docker run -it -v ~/Downloads/:/tmp1 IMAGE_ID bash

# Copy the files to the folder you mounted
cp /out/* /tmp1
```

To run them in a separate container, just ensure that the 3 files are in the same directory and the 3 files have the executable bit on so they can be executed.
