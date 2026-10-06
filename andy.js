(function () {
    'use strict';

    // =========================================================
    // ANDY.JS
    // SISTEMA DE ANUNCIOS + MEDIA + CARDS + SPA + ESTADÍSTICAS
    // =========================================================


    // =========================================================
    // PROVEEDORES
    // =========================================================

    const AD_SOURCES = [
        'https://URL-EMPRESA-1',
        'https://URL-EMPRESA-2',
        'https://URL-EMPRESA-3',
        'https://URL-EMPRESA-4',
        'https://URL-EMPRESA-5',
        'https://URL-EMPRESA-6',
        'https://URL-EMPRESA-7',
        'https://URL-EMPRESA-8',
        'https://URL-EMPRESA-9',
        'https://URL-EMPRESA-10'
    ];


    // =========================================================
    // CONFIGURACIÓN
    // =========================================================

    const CONFIG = {

        MIN_INTERVAL: 60000,

        MAX_ADS_PER_MINUTE: 60,

        WINDOW_MS: 60000,

        INITIAL_DELAY: 1500,

        EMBED_SCAN_INTERVAL: 5000,

        LOAD_TIMEOUT: 15000,

        MAX_LOGS: 500,

        EVENTS: true,

        DETECT_EMBEDS: true,

        DETECT_URL_CHANGES: true,

        VISIBILITY: true,

        DETECT_CARDS: true,

        DETECT_VIDEOS: true,

        DETECT_IFRAMES: true,

        DETECT_EPISODES: true,

        DETECT_BUTTONS: true,

        DETECT_FULLSCREEN: true,

        DETECT_SPA: true,

        DETECT_LINKS: true,

        DETECT_INTERSECTION: true,

        DEBUG: true,

        INTERSECTION_THRESHOLD: 0.50

    };


    // =========================================================
    // VARIABLES PRINCIPALES
    // =========================================================

    let lastFire = 0;

    let loading = false;

    let providerIndex = 0;

    let lastProviderIndex = -1;

    let totalRequests = 0;

    let successfulLoads = 0;

    let failedLoads = 0;

    let pageLoads = 0;

    let embedLoads = 0;

    let interactionEvents = 0;

    let navigationEvents = 0;

    let cardClicks = 0;

    let videoPlays = 0;

    let videoPauses = 0;

    let videoEnds = 0;

    let videoSeeks = 0;

    let fullscreenEvents = 0;

    let episodeChanges = 0;

    let buttonClicks = 0;

    let iframeLoads = 0;

    let visibleElements = 0;

    let lastUrl = location.href;

    let observer = null;

    let embedInterval = null;

    let intersectionObserver = null;

    let initialized = false;


    // =========================================================
    // ARRAYS / OBJETOS
    // =========================================================

    const adTimestamps = [];

    const historyLog = [];

    const providerHits =
        new Array(AD_SOURCES.length).fill(0);

    const eventStats = {};

    const videoStats = {};

    const episodeStats = {};

    const cooldowns = {};

    const trackedVideos =
        new WeakSet();

    const trackedIframes =
        new WeakSet();

    const trackedCards =
        new WeakSet();

    const trackedButtons =
        new WeakSet();

    const trackedElements =
        new WeakSet();


    // =========================================================
    // LOG
    // =========================================================

    function registrarLog(tipo, detalle) {

        historyLog.push({

            tiempo:
                new Date().toISOString(),

            tipo: tipo,

            detalle: detalle,

            url:
                location.href

        });

        if (
            historyLog.length >
            CONFIG.MAX_LOGS
        ) {

            historyLog.shift();

        }
    }


    // =========================================================
    // EVENTO PERSONALIZADO
    // =========================================================

    function emitirEvento(nombre, detalle) {

        try {

            window.dispatchEvent(
                new CustomEvent(
                    nombre,
                    {
                        detail:
                            detalle || {}
                    }
                )
            );

        } catch (error) {

            if (CONFIG.DEBUG) {

                console.warn(
                    '[Andy.js] Evento error:',
                    error
                );

            }

        }
    }


    // =========================================================
    // ESTADÍSTICAS DE EVENTOS
    // =========================================================

    function registrarEstadistica(tipo) {

        if (!eventStats[tipo]) {

            eventStats[tipo] = {

                total: 0,

                primera:
                    Date.now(),

                ultima:
                    Date.now()

            };

        } else {

            eventStats[tipo].total++;

            eventStats[tipo].ultima =
                Date.now();

            return;

        }

        eventStats[tipo].total = 1;
    }


    // =========================================================
    // COOLDOWN POR EVENTO
    // =========================================================

    function puedeEjecutarEvento(tipo) {

        const ahora =
            Date.now();

        const cooldown =
            tipo === 'click'
                ? 15000
                : tipo === 'media-play'
                    ? 20000
                    : tipo === 'embed-load'
                        ? 20000
                        : tipo === 'navigation'
                            ? 15000
                            : tipo === 'episode'
                                ? 20000
                                : CONFIG.MIN_INTERVAL;

        if (
            cooldowns[tipo] &&
            ahora - cooldowns[tipo] <
            cooldown
        ) {

            return false;

        }

        cooldowns[tipo] =
            ahora;

        return true;
    }


    // =========================================================
    // EJECUTAR EVENTO
    // =========================================================

    function dispararEvento(tipo, datos) {

        registrarEstadistica(tipo);

        emitirEvento(
            'andyads:event',
            {
                tipo: tipo,
                datos: datos || {},
                timestamp: Date.now()
            }
        );

        if (
            !puedeEjecutarEvento(tipo)
        ) {

            return false;

        }

        return loadAd(tipo);
    }


    // =========================================================
    // PROVEEDOR
    // =========================================================

    function nextProvider() {

        if (!AD_SOURCES.length) {

            return null;

        }

        let indice =
            providerIndex;

        if (
            AD_SOURCES.length > 1 &&
            indice === lastProviderIndex
        ) {

            indice =
                (
                    indice + 1
                ) %
                AD_SOURCES.length;

        }

        lastProviderIndex =
            indice;

        providerHits[indice]++;

        providerIndex =
            (
                indice + 1
            ) %
            AD_SOURCES.length;

        return AD_SOURCES[indice];
    }


    // =========================================================
    // LIMPIAR TIMESTAMPS
    // =========================================================

    function limpiarTimestamps() {

        const ahora =
            Date.now();

        while (
            adTimestamps.length &&
            adTimestamps[0] <
            ahora - CONFIG.WINDOW_MS
        ) {

            adTimestamps.shift();

        }
    }


    // =========================================================
    // COMPROBAR SI PUEDE CARGAR
    // =========================================================

    function canLoadAd() {

        limpiarTimestamps();

        const ahora =
            Date.now();

        if (
            adTimestamps.length >=
            CONFIG.MAX_ADS_PER_MINUTE
        ) {

            registrarLog(
                'BLOQUEO',
                'Límite de anuncios alcanzado'
            );

            return false;
        }

        if (
            ahora - lastFire <
            CONFIG.MIN_INTERVAL
        ) {

            return false;

        }

        if (loading) {

            return false;

        }

        return true;
    }


    // =========================================================
    // CONSTRUIR URL
    // =========================================================

    function construirAdUrl(url) {

        const separador =
            url.includes('?')
                ? '&'
                : '?';

        return (
            url +
            separador +
            '_=' +
            Date.now() +
            '&rand=' +
            Math.random()
                .toString(36)
                .substring(2, 10)
        );
    }


    // =========================================================
    // CARGAR ANUNCIO
    // =========================================================

    function loadAd(motivo) {

        try {

            if (!canLoadAd()) {

                return false;

            }

            const adUrl =
                nextProvider();

            if (!adUrl) {

                return false;

            }

            loading = true;

            totalRequests++;

            registrarLog(
                'SOLICITUD',
                motivo || 'manual'
            );

            emitirEvento(
                'andyads:beforeload',
                {
                    provider:
                        adUrl,

                    motivo:
                        motivo || 'manual'
                }
            );

            const script =
                document.createElement(
                    'script'
                );

            script.async = true;

            script.src =
                construirAdUrl(
                    adUrl
                );

            script.dataset.andyAds =
                'true';

            let terminado = false;


            // -------------------------------------------------
            // FINALIZAR
            // -------------------------------------------------

            function finalizar(exitoso) {

                if (terminado) {

                    return;

                }

                terminado = true;

                loading = false;

                if (
                    script.parentNode
                ) {

                    script.parentNode
                        .removeChild(
                            script
                        );

                }

                if (exitoso) {

                    lastFire =
                        Date.now();

                    adTimestamps.push(
                        lastFire
                    );

                    successfulLoads++;

                    registrarLog(
                        'EXITO',
                        adUrl
                    );

                    emitirEvento(
                        'andyads:success',
                        {
                            provider:
                                adUrl
                        }
                    );

                } else {

                    failedLoads++;

                    registrarLog(
                        'ERROR',
                        adUrl
                    );

                    emitirEvento(
                        'andyads:error',
                        {
                            provider:
                                adUrl
                        }
                    );
                }
            }


            // -------------------------------------------------
            // LOAD
            // -------------------------------------------------

            script.onload =
                function () {

                    finalizar(true);

                    if (CONFIG.DEBUG) {

                        console.log(
                            '[Andy.js] Anuncio cargado:',
                            adUrl
                        );

                    }
                };


            // -------------------------------------------------
            // ERROR
            // -------------------------------------------------

            script.onerror =
                function () {

                    finalizar(false);

                    if (CONFIG.DEBUG) {

                        console.warn(
                            '[Andy.js] Error:',
                            adUrl
                        );

                    }
                };


            document.head.appendChild(
                script
            );


            // -------------------------------------------------
            // TIMEOUT
            // -------------------------------------------------

            setTimeout(
                function () {

                    if (!terminado) {

                        registrarLog(
                            'TIMEOUT',
                            adUrl
                        );

                        finalizar(false);

                    }

                },
                CONFIG.LOAD_TIMEOUT
            );

            return true;

        } catch (error) {

            loading = false;

            failedLoads++;

            registrarLog(
                'EXCEPCION',
                error.message
            );

            if (CONFIG.DEBUG) {

                console.error(
                    '[Andy.js]',
                    error
                );

            }

            return false;
        }
    }


    // =========================================================
    // DETECTAR IFRAMES
    // =========================================================

    function detectarIframes() {

        if (
            !CONFIG.DETECT_IFRAMES
        ) {

            return;

        }

        const iframes =
            document.querySelectorAll(
                'iframe'
            );

        iframes.forEach(
            function (iframe) {

                if (
                    trackedIframes.has(
                        iframe
                    )
                ) {

                    return;

                }

                trackedIframes.add(
                    iframe
                );

                iframe.addEventListener(
                    'load',
                    function () {

                        iframeLoads++;

                        embedLoads++;

                        registrarLog(
                            'IFRAME_LOAD',
                            iframe.src ||
                            'iframe'
                        );

                        emitirEvento(
                            'andyads:iframe',
                            {
                                src:
                                    iframe.src ||
                                    ''
                            }
                        );

                        dispararEvento(
                            'embed-load',
                            {
                                tipo:
                                    'iframe',

                                src:
                                    iframe.src ||
                                    ''
                            }
                        );

                    }
                );

            }
        );
    }


    // =========================================================
    // DETECTAR VIDEOS
    // =========================================================

    function detectarVideos() {

        if (
            !CONFIG.DETECT_VIDEOS
        ) {

            return;

        }

        const videos =
            document.querySelectorAll(
                'video'
            );

        videos.forEach(
            function (video) {

                if (
                    trackedVideos.has(
                        video
                    )
                ) {

                    return;

                }

                trackedVideos.add(
                    video
                );


                // ---------------------------------------------
                // IDENTIFICADOR
                // ---------------------------------------------

                const videoId =
                    video.dataset.videoId ||
                    video.dataset.movieId ||
                    video.id ||
                    video.currentSrc ||
                    video.src ||
                    'video-' +
                    Math.random()
                        .toString(36)
                        .substring(2, 8);


                videoStats[videoId] = {

                    plays: 0,

                    pauses: 0,

                    ends: 0,

                    seeks: 0,

                    ultimoTiempo: 0,

                    ultimaActividad:
                        Date.now()

                };


                // ---------------------------------------------
                // PLAY
                // ---------------------------------------------

                video.addEventListener(
                    'play',
                    function () {

                        videoPlays++;

                        videoStats[
                            videoId
                        ].plays++;

                        videoStats[
                            videoId
                        ].ultimaActividad =
                            Date.now();

                        registrarLog(
                            'VIDEO_PLAY',
                            videoId
                        );

                        emitirEvento(
                            'andyads:video-play',
                            {
                                id:
                                    videoId,

                                tiempo:
                                    video.currentTime,

                                duracion:
                                    video.duration
                            }
                        );

                        dispararEvento(
                            'media-play',
                            {
                                video:
                                    videoId
                            }
                        );

                    }
                );


                // ---------------------------------------------
                // PAUSE
                // ---------------------------------------------

                video.addEventListener(
                    'pause',
                    function () {

                        videoPauses++;

                        videoStats[
                            videoId
                        ].pauses++;

                        videoStats[
                            videoId
                        ].ultimoTiempo =
                            video.currentTime;

                        registrarLog(
                            'VIDEO_PAUSE',
                            videoId
                        );

                        emitirEvento(
                            'andyads:video-pause',
                            {
                                id:
                                    videoId,

                                tiempo:
                                    video.currentTime
                            }
                        );

                    }
                );


                // ---------------------------------------------
                // ENDED
                // ---------------------------------------------

                video.addEventListener(
                    'ended',
                    function () {

                        videoEnds++;

                        videoStats[
                            videoId
                        ].ends++;

                        registrarLog(
                            'VIDEO_ENDED',
                            videoId
                        );

                        emitirEvento(
                            'andyads:video-ended',
                            {
                                id:
                                    videoId,

                                duracion:
                                    video.duration
                            }
                        );

                    }
                );


                // ---------------------------------------------
                // SEEK
                // ---------------------------------------------

                video.addEventListener(
                    'seeking',
                    function () {

                        videoSeeks++;

                        videoStats[
                            videoId
                        ].seeks++;

                        videoStats[
                            videoId
                        ].ultimoTiempo =
                            video.currentTime;

                        emitirEvento(
                            'andyads:video-seek',
                            {
                                id:
                                    videoId,

                                tiempo:
                                    video.currentTime
                            }
                        );

                    }
                );


                // ---------------------------------------------
                // VOLUMEN
                // ---------------------------------------------

                video.addEventListener(
                    'volumechange',
                    function () {

                        emitirEvento(
                            'andyads:volume',
                            {
                                id:
                                    videoId,

                                volumen:
                                    video.volume,

                                muted:
                                    video.muted
                            }
                        );

                    }
                );


                // ---------------------------------------------
                // TIME UPDATE
                // ---------------------------------------------

                let ultimoSegundo = -1;

                video.addEventListener(
                    'timeupdate',
                    function () {

                        const segundo =
                            Math.floor(
                                video.currentTime
                            );

                        if (
                            segundo ===
                            ultimoSegundo
                        ) {

                            return;

                        }

                        ultimoSegundo =
                            segundo;

                        videoStats[
                            videoId
                        ].ultimoTiempo =
                            video.currentTime;

                    }
                );

            }
        );
    }


    // =========================================================
    // DETECTAR CARDS
    // =========================================================

    function detectarCards() {

        if (
            !CONFIG.DETECT_CARDS
        ) {

            return;

        }

        const cards =
            document.querySelectorAll(
                [
                    '.card',
                    '.movie-card',
                    '.movie',
                    '.pelicula',
                    '.pelicula-card',
                    '.serie-card',
                    '.episode-card',
                    '[data-movie-id]',
                    '[data-tmdb-id]',
                    '[data-card]',
                    '[data-pelicula]'
                ].join(',')
            );


        cards.forEach(
            function (card) {

                if (
                    trackedCards.has(
                        card
                    )
                ) {

                    return;

                }

                trackedCards.add(
                    card
                );

                card.addEventListener(
                    'click',
                    function () {

                        cardClicks++;

                        const movieId =
                            card.dataset.movieId ||
                            card.dataset.tmdbId ||
                            card.dataset.pelicula ||
                            card.dataset.id ||
                            null;

                        const titulo =
                            (
                                card.dataset.title ||
                                card.querySelector(
                                    '.title, .movie-title, h2, h3'
                                )?.textContent ||
                                card.textContent ||
                                ''
                            )
                            .trim()
                            .substring(
                                0,
                                200
                            );


                        registrarLog(
                            'CARD_CLICK',
                            titulo
                        );

                        emitirEvento(
                            'andyads:card-click',
                            {
                                movieId:
                                    movieId,

                                titulo:
                                    titulo
                            }
                        );

                    },
                    {
                        passive: true
                    }
                );

            }
        );
    }


    // =========================================================
    // DETECTAR EPISODIOS
    // =========================================================

    function detectarEpisodios() {

        if (
            !CONFIG.DETECT_EPISODES
        ) {

            return;

        }

        const episodios =
            document.querySelectorAll(
                [
                    '[data-episode]',
                    '[data-episode-id]',
                    '[data-season]',
                    '.episode',
                    '.episode-card',
                    '.episodio',
                    '.episode-item',
                    '.season-episode',
                    '.btn-episode'
                ].join(',')
            );


        episodios.forEach(
            function (episodio) {

                if (
                    episodio.dataset
                        .andyEpisodeTracked
                ) {

                    return;

                }

                episodio.dataset
                    .andyEpisodeTracked =
                    'true';


                episodio.addEventListener(
                    'click',
                    function () {

                        episodeChanges++;

                        const episode =
                            episodio.dataset.episode ||
                            episodio.dataset.episodeId ||
                            episodio.dataset.id ||
                            null;

                        const season =
                            episodio.dataset.season ||
                            episodio.dataset.temporada ||
                            null;

                        episodeStats[
                            String(
                                season ||
                                'unknown'
                            )
                        ] = (
                            episodeStats[
                                String(
                                    season ||
                                    'unknown'
                                )
                            ] || 0
                        ) + 1;


                        registrarLog(
                            'EPISODE_CHANGE',
                            'S' +
                            (
                                season ||
                                '?'
                            ) +
                            ' E' +
                            (
                                episode ||
                                '?'
                            )
                        );


                        emitirEvento(
                            'andyads:episode',
                            {
                                season:
                                    season,

                                episode:
                                    episode
                            }
                        );


                        dispararEvento(
                            'episode',
                            {
                                season:
                                    season,

                                episode:
                                    episode
                            }
                        );

                    },
                    {
                        passive: true
                    }
                );

            }
        );
    }


    // =========================================================
    // DETECTAR BOTONES
    // =========================================================

    function detectarBotones() {

        if (
            !CONFIG.DETECT_BUTTONS
        ) {

            return;

        }

        const botones =
            document.querySelectorAll(
                [
                    'button',
                    '[role="button"]',
                    '.btn',
                    '.button',
                    '[data-action]'
                ].join(',')
            );


        botones.forEach(
            function (boton) {

                if (
                    trackedButtons.has(
                        boton
                    )
                ) {

                    return;

                }

                trackedButtons.add(
                    boton
                );


                boton.addEventListener(
                    'click',
                    function () {

                        buttonClicks++;

                        const texto =
                            (
                                boton.innerText ||
                                boton.textContent ||
                                boton.getAttribute(
                                    'aria-label'
                                ) ||
                                boton.dataset.action ||
                                'button'
                            )
                            .trim()
                            .substring(
                                0,
                                150
                            );


                        registrarLog(
                            'BUTTON_CLICK',
                            texto
                        );


                        emitirEvento(
                            'andyads:button',
                            {
                                texto:
                                    texto,

                                action:
                                    boton.dataset.action ||
                                    null
                            }
                        );

                    },
                    {
                        passive: true
                    }
                );

            }
        );
    }


    // =========================================================
    // FULLSCREEN
    // =========================================================

    function iniciarFullscreen() {

        if (
            !CONFIG.DETECT_FULLSCREEN
        ) {

            return;

        }


        document.addEventListener(
            'fullscreenchange',
            function () {

                fullscreenEvents++;

                const activo =
                    !!document.fullscreenElement;


                registrarLog(
                    'FULLSCREEN',
                    activo
                        ? 'Entró en pantalla completa'
                        : 'Salió de pantalla completa'
                );


                emitirEvento(
                    'andyads:fullscreen',
                    {
                        activo:
                            activo,

                        elemento:
                            document.fullscreenElement ||
                            null
                    }
                );

            }
        );


        document.addEventListener(
            'webkitfullscreenchange',
            function () {

                fullscreenEvents++;

                emitirEvento(
                    'andyads:fullscreen',
                    {
                        activo:
                            true
                    }
                );

            }
        );
    }


    // =========================================================
    // DETECTAR EMBEDS GENERALES
    // =========================================================

    function detectEmbeds() {

        if (
            !CONFIG.DETECT_EMBEDS
        ) {

            return;

        }

        const elementos =
            document.querySelectorAll(
                'iframe, embed, object, video, audio'
            );


        elementos.forEach(
            function (elemento) {

                if (
                    elemento.dataset
                        .andyTracked
                ) {

                    return;

                }

                elemento.dataset
                    .andyTracked =
                    'true';


                elemento.addEventListener(
                    'load',
                    function () {

                        embedLoads++;

                        registrarLog(
                            'EMBED_LOAD',
                            elemento.src ||
                            elemento.currentSrc ||
                            elemento.data ||
                            'multimedia'
                        );

                        emitirEvento(
                            'andyads:embed',
                            {
                                elemento:
                                    elemento
                            }
                        );

                    }
                );

            }
        );

        detectarIframes();

        detectarVideos();
    }


    // =========================================================
    // INTERSECTION OBSERVER
    // =========================================================

    function iniciarIntersectionObserver() {

        if (
            !CONFIG.DETECT_INTERSECTION ||
            !window.IntersectionObserver
        ) {

            return;

        }


        intersectionObserver =
            new IntersectionObserver(
                function (entries) {

                    entries.forEach(
                        function (entry) {

                            if (
                                !entry.isIntersecting
                            ) {

                                return;

                            }


                            const elemento =
                                entry.target;


                            if (
                                trackedElements.has(
                                    elemento
                                )
                            ) {

                                return;

                            }


                            trackedElements.add(
                                elemento
                            );

                            visibleElements++;


                            registrarLog(
                                'ELEMENT_VISIBLE',
                                elemento.tagName
                            );


                            emitirEvento(
                                'andyads:element-visible',
                                {
                                    elemento:
                                        elemento
                                }
                            );

                        }
                    );

                },
                {
                    threshold:
                        CONFIG.INTERSECTION_THRESHOLD
                }
            );


        observarElementosVisibles();
    }


    // =========================================================
    // OBSERVAR ELEMENTOS
    // =========================================================

    function observarElementosVisibles() {

        if (
            !intersectionObserver
        ) {

            return;

        }


        const elementos =
            document.querySelectorAll(
                [
                    'video',
                    'iframe',
                    '.card',
                    '.movie-card',
                    '.pelicula-card',
                    '.episode-card'
                ].join(',')
            );


        elementos.forEach(
            function (elemento) {

                try {

                    intersectionObserver.observe(
                        elemento
                    );

                } catch (error) {

                    if (CONFIG.DEBUG) {

                        console.warn(
                            '[Andy.js] Intersection:',
                            error
                        );

                    }

                }

            }
        );
    }


    // =========================================================
    // MUTATION OBSERVER
    // =========================================================

    function iniciarObserver() {

        if (
            !window.MutationObserver
        ) {

            return;

        }


        observer =
            new MutationObserver(
                function (mutations) {

                    let cambios = false;


                    for (
                        const mutation
                        of mutations
                    ) {

                        if (
                            mutation.addedNodes &&
                            mutation.addedNodes.length
                        ) {

                            cambios = true;

                            break;

                        }

                    }


                    if (cambios) {

                        detectarTodo();

                    }

                }
            );


        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );
    }


    // =========================================================
    // DETECTAR TODO
    // =========================================================

    function detectarTodo() {

        detectEmbeds();

        detectarCards();

        detectarEpisodios();

        detectarBotones();

        detectarIframes();

        detectarVideos();

        observarElementosVisibles();
    }


    // =========================================================
    // CAMBIO DE URL
    // =========================================================

    function comprobarUrl() {

        if (
            !CONFIG.DETECT_URL_CHANGES
        ) {

            return;

        }


        const nuevaUrl =
            location.href;


        if (
            nuevaUrl === lastUrl
        ) {

            return;

        }


        const anterior =
            lastUrl;


        lastUrl =
            nuevaUrl;


        navigationEvents++;


        registrarLog(
            'NAVEGACION',
            nuevaUrl
        );


        emitirEvento(
            'andyads:navigation',
            {
                anterior:
                    anterior,

                nueva:
                    nuevaUrl
            }
        );


        detectarTodo();


        dispararEvento(
            'navigation',
            {
                anterior:
                    anterior,

                nueva:
                    nuevaUrl
            }
        );
    }


    // =========================================================
    // HISTORY API / SPA
    // =========================================================

    function interceptarHistory() {

        if (
            !CONFIG.DETECT_SPA
        ) {

            return;

        }


        const pushStateOriginal =
            history.pushState;


        const replaceStateOriginal =
            history.replaceState;


        history.pushState =
            function () {

                const resultado =
                    pushStateOriginal.apply(
                        this,
                        arguments
                    );


                setTimeout(
                    comprobarUrl,
                    50
                );


                return resultado;
            };


        history.replaceState =
            function () {

                const resultado =
                    replaceStateOriginal.apply(
                        this,
                        arguments
                    );


                setTimeout(
                    comprobarUrl,
                    50
                );


                return resultado;
            };


        window.addEventListener(
            'popstate',
            comprobarUrl
        );


        window.addEventListener(
            'hashchange',
            comprobarUrl
        );
    }


    // =========================================================
    // EVENTOS GENERALES
    // =========================================================

    function iniciarEventos() {

        if (
            !CONFIG.EVENTS
        ) {

            return;

        }


        const eventos = [

            'click',
            'touchstart',
            'mousedown',
            'pointerdown',
            'keydown',
            'wheel',
            'focus'

        ];


        eventos.forEach(
            function (evento) {

                document.addEventListener(
                    evento,
                    function () {

                        interactionEvents++;


                        registrarEstadistica(
                            'interaction-' +
                            evento
                        );


                        emitirEvento(
                            'andyads:interaction',
                            {
                                tipo:
                                    evento
                            }
                        );

                    },
                    {
                        passive: true,
                        capture: true
                    }
                );

            }
        );
    }


    // =========================================================
    // VISIBILIDAD
    // =========================================================

    function iniciarVisibility() {

        if (
            !CONFIG.VISIBILITY
        ) {

            return;

        }


        document.addEventListener(
            'visibilitychange',
            function () {

                if (
                    !document.hidden
                ) {

                    registrarLog(
                        'VISIBILITY',
                        'Página visible'
                    );


                    emitirEvento(
                        'andyads:visible'
                    );


                    dispararEvento(
                        'visibility'
                    );

                }

            }
        );
    }


    // =========================================================
    // PAGE SHOW
    // =========================================================

    window.addEventListener(
        'pageshow',
        function () {

            pageLoads++;


            registrarLog(
                'PAGESHOW',
                'Página mostrada'
            );


            emitirEvento(
                'andyads:pageshow'
            );

        }
    );


    // =========================================================
    // PAGE HIDE
    // =========================================================

    window.addEventListener(
        'pagehide',
        function () {

            emitirEvento(
                'andyads:pagehide'
            );

        }
    );


    // =========================================================
    // ESCANEO PERIÓDICO
    // =========================================================

    function iniciarEscaneo() {

        embedInterval =
            setInterval(
                function () {

                    detectarTodo();

                    comprobarUrl();

                },
                CONFIG.EMBED_SCAN_INTERVAL
            );
    }


    // =========================================================
    // API PÚBLICA
    // =========================================================

    window.AndyAds = {


        // -----------------------------------------------------
        // CARGAR
        // -----------------------------------------------------

        load: function () {

            return loadAd(
                'api-manual'
            );

        },


        // -----------------------------------------------------
        // PROVEEDORES
        // -----------------------------------------------------

        providers: function () {

            return AD_SOURCES.slice();

        },


        // -----------------------------------------------------
        // PROVEEDOR ACTUAL
        // -----------------------------------------------------

        currentProvider: function () {

            if (
                !AD_SOURCES.length
            ) {

                return null;

            }


            return AD_SOURCES[
                providerIndex
            ];

        },


        // -----------------------------------------------------
        // ÚLTIMO PROVEEDOR
        // -----------------------------------------------------

        lastProvider: function () {

            if (
                lastProviderIndex < 0
            ) {

                return null;

            }


            return AD_SOURCES[
                lastProviderIndex
            ];

        },


        // -----------------------------------------------------
        // CONTADOR
        // -----------------------------------------------------

        count: function () {

            limpiarTimestamps();

            return adTimestamps.length;

        },


        // -----------------------------------------------------
        // ESTADÍSTICAS
        // -----------------------------------------------------

        metrics: function () {

            return {

                solicitudesTotales:
                    totalRequests,

                exitosos:
                    successfulLoads,

                fallidos:
                    failedLoads,

                tasaDeExito:
                    totalRequests > 0
                        ? (
                            (
                                successfulLoads /
                                totalRequests
                            ) * 100
                        ).toFixed(2) +
                        '%'
                        : '0%',

                hitsPorProveedor:
                    providerHits.slice(),

                proveedorActual:
                    this.currentProvider(),

                ultimoProveedor:
                    this.lastProvider(),

                embeds:
                    embedLoads,

                iframes:
                    iframeLoads,

                interacciones:
                    interactionEvents,

                navegaciones:
                    navigationEvents,

                cards:
                    cardClicks,

                videosPlay:
                    videoPlays,

                videosPause:
                    videoPauses,

                videosFinalizados:
                    videoEnds,

                videosSeek:
                    videoSeeks,

                episodios:
                    episodeChanges,

                botones:
                    buttonClicks,

                fullscreen:
                    fullscreenEvents,

                elementosVisibles:
                    visibleElements,

                cargasPagina:
                    pageLoads,

                urlActual:
                    location.href

            };

        },


        // -----------------------------------------------------
        // ESTADÍSTICAS DE EVENTOS
        // -----------------------------------------------------

        eventStats: function () {

            return JSON.parse(
                JSON.stringify(
                    eventStats
                )
            );

        },


        // -----------------------------------------------------
        // ESTADÍSTICAS DE VIDEOS
        // -----------------------------------------------------

        videos: function () {

            return JSON.parse(
                JSON.stringify(
                    videoStats
                )
            );

        },


        // -----------------------------------------------------
        // ESTADÍSTICAS DE EPISODIOS
        // -----------------------------------------------------

        episodes: function () {

            return JSON.parse(
                JSON.stringify(
                    episodeStats
                )
            );

        },


        // -----------------------------------------------------
        // LOGS
        // -----------------------------------------------------

        logs: function () {

            return historyLog.slice();

        },


        // -----------------------------------------------------
        // URL
        // -----------------------------------------------------

        url: function () {

            return location.href;

        },


        // -----------------------------------------------------
        // ESTADO
        // -----------------------------------------------------

        status: function () {

            return {

                loading:
                    loading,

                ultimoDisparo:
                    lastFire,

                proveedor:
                    this.currentProvider(),

                anunciosVentana:
                    this.count(),

                inicializado:
                    initialized

            };

        },


        // -----------------------------------------------------
        // ESCANEAR
        // -----------------------------------------------------

        scan: function () {

            detectarTodo();

            return true;

        },


        // -----------------------------------------------------
        // RESET
        // -----------------------------------------------------

        reset: function () {

            adTimestamps.length = 0;

            historyLog.length = 0;

            lastFire = 0;

            loading = false;

            totalRequests = 0;

            successfulLoads = 0;

            failedLoads = 0;

            pageLoads = 0;

            embedLoads = 0;

            iframeLoads = 0;

            interactionEvents = 0;

            navigationEvents = 0;

            cardClicks = 0;

            videoPlays = 0;

            videoPauses = 0;

            videoEnds = 0;

            videoSeeks = 0;

            fullscreenEvents = 0;

            episodeChanges = 0;

            buttonClicks = 0;

            visibleElements = 0;

            providerIndex = 0;

            lastProviderIndex = -1;

            providerHits.fill(0);

            Object.keys(
                eventStats
            ).forEach(
                key =>
                    delete eventStats[key]
            );

            Object.keys(
                videoStats
            ).forEach(
                key =>
                    delete videoStats[key]
            );

            Object.keys(
                episodeStats
            ).forEach(
                key =>
                    delete episodeStats[key]
            );

            Object.keys(
                cooldowns
            ).forEach(
                key =>
                    delete cooldowns[key]
            );


            registrarLog(
                'RESET',
                'Sistema reiniciado'
            );


            emitirEvento(
                'andyads:reset'
            );


            if (CONFIG.DEBUG) {

                console.log(
                    '[Andy.js] Sistema reiniciado'
                );

            }

        },


        // -----------------------------------------------------
        // CONFIG
        // -----------------------------------------------------

        config: function () {

            return Object.assign(
                {},
                CONFIG
            );

        },


        // -----------------------------------------------------
        // DEBUG
        // -----------------------------------------------------

        debug: function () {

            return {

                config:
                    this.config(),

                metrics:
                    this.metrics(),

                events:
                    this.eventStats(),

                videos:
                    this.videos(),

                episodes:
                    this.episodes(),

                status:
                    this.status()

            };

        }

    };


    // =========================================================
    // INICIO
    // =========================================================

    function iniciarAndyAds() {

        if (initialized) {

            return;

        }

        initialized = true;


        if (CONFIG.DEBUG) {

            console.log(
                '[Andy.js] Inicializando...'
            );

        }


        registrarLog(
            'START',
            'AndyAds iniciado'
        );


        iniciarEventos();

        iniciarVisibility();

        interceptarHistory();

        iniciarFullscreen();

        iniciarObserver();

        iniciarIntersectionObserver();

        iniciarEscaneo();


        detectarTodo();


        // -----------------------------------------------------
        // PRIMERA CARGA
        // -----------------------------------------------------

        setTimeout(
            function () {

                loadAd(
                    'initial'
                );

            },
            CONFIG.INITIAL_DELAY
        );


        // -----------------------------------------------------
        // EVENTO READY
        // -----------------------------------------------------

        emitirEvento(
            'andyads:ready',
            {
                version:
                    '2.0',

                url:
                    location.href
            }
        );


        if (CONFIG.DEBUG) {

            console.log(
                '[Andy.js] Sistema iniciado correctamente.'
            );

            console.log(
                '[Andy.js] API disponible: window.AndyAds'
            );

        }

    }


    // =========================================================
    // ESPERAR DOM
    // =========================================================

    if (
        document.readyState ===
        'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            iniciarAndyAds,
            {
                once: true
            }
        );

    } else {

        iniciarAndyAds();

    }

})();

Lo nuevo que reconoce

Con esta versión puedes consultar:

AndyAds.metrics()

para obtener las estadísticas generales.

AndyAds.videos()

para estadísticas de los videos.

AndyAds.episodes()

para episodios/temporadas.

AndyAds.eventStats()

para saber qué eventos han ocurrido.

Y:

AndyAds.debug()

te devuelve prácticamente todo el estado del sistema.

También puedes escuchar eventos desde tu HTML:

window.addEventListener(
    'andyads:video-play',
    function (e) {
        console.log(
            'Video iniciado:',
            e.detail
        );
    }
);

o:

window.addEventListener(
    'andyads:episode',
    function (e) {
        console.log(
            'Episodio:',
            e.detail
        );
    }
);

o:

window.addEventListener(
    'andyads:card-click',
    function (e) {
        console.log(
            'Card:',
            e.detail
        );
    }
);
