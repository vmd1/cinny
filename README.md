# Cinny

Finny is a fork of Cinny, a Matrix client focusing primarily on simple, elegant and secure interface. The main goal is to have an instant messaging application that is easy on people and has a modern touch.

This fork has an opiniated UI, as well as native support for Bridge Management. It focuses on replicating the features of beeper.com into an open-source variant. Contribtions are welcome.


## Getting started
A hosted web app is currently not available, see Self-hosting below.

A desktop app is incoming, please wait.

## Self-hosting
To host Cinny on your own, simply pull the docker image from GitHub Container Registry.

* The default homeservers and explore pages are defined in [`config.json`](config.json).

* You need to set up redirects to serve the assests. Example configurations; [netlify](netlify.toml), [nginx](contrib/nginx/cinny.domain.tld.conf), [caddy](contrib/caddy/caddyfile).
    * If you have trouble configuring redirects you can [enable hash routing](config.json#L35) — the url in the browser will have a `/#/` between the domain and open channel (ie. `app.cinny.in/#/home/` instead of `app.cinny.in/home/`) but you won't have to configure your webserver.

* To deploy on subdirectory, you need to rebuild the app youself after updating the `base` path in [`build.config.ts`](build.config.ts).
    * For example, if you want to deploy on `https://cinny.in/app`, then set `base: '/app'`.

## Local development
> [!TIP]
> We recommend using a version manager as versions change very quickly. You will likely need to switch between multiple Node.js versions based on the needs of different projects you're working on. [NVM on windows](https://github.com/coreybutler/nvm-windows#installation--upgrades) on Windows and [nvm](https://github.com/nvm-sh/nvm) on Linux/macOS are pretty good choices. Recommended nodejs version is Krypton LTS (v24.13.1).

Execute the following commands to start a development server:
```sh
npm ci # Installs all dependencies
npm start # Serve a development version
```

To build the app:
```sh
npm run build # Compiles the app into the dist/ directory
```

### Running with Docker
This repository includes a Dockerfile, which builds the application from source and serves it with Nginx on port 80. To
use this locally, you can build the container like so:
```
docker build -t cinny:latest .
```

You can then run the container you've built with a command similar to this:
```
docker run -p 8080:80 cinny:latest
```

This will forward your `localhost` port 8080 to the container's port 80. You can visit the app in your browser by navigating to `http://localhost:8080`.
