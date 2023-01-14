// noinspection ES6MissingAwait

importScripts('libs/idb.umd.js')
importScripts('projects.js')
importScripts('main.js')

// TODO отложенный importScripts пока не работают, подробнее https://bugs.chromium.org/p/chromium/issues/detail?id=1198822
self.addEventListener('install', async () => {
    importScripts('libs/linkedom.js')
    importScripts('libs/evalCore.umd.js')
    importScripts('scripts/mcserverlist_silentvote.js', 'scripts/misterlauncher_silentvote.js', 'scripts/monitoringminecraft_silentvote.js', 'scripts/serverpact_silentvote.js')

    // noinspection JSUndeclaredVariable
    initialized2 = false

    await waitInitialize1()

    openedProjects = await db.get('other', 'openedProjects')
    if (openedProjects.size > 0) {
        for (const key of openedProjects.keys()) {
            openedProjects.delete(key)
            if (!isNaN(key)) chrome.tabs.remove(key)
                .catch(error => {if (!error.message.includes('No tab with id')) console.warn(error)})
        }
        await db.put('other', openedProjects, 'openedProjects')
    }

    // noinspection JSUndeclaredVariable
    initialized2 = true

    console.log(chrome.i18n.getMessage('start', chrome.runtime.getManifest().version))
})

//Текущие fetch запросы
// noinspection ES6ConvertVarToLetConst
// var fetchProjects = new Map()
//ID группы вкладок в которой сейчас открыты вкладки расширения
let groupId
//Если этот браузер не поддерживает группировку вкладок
let notSupportedGroupTabs = false

//Нужно ли сейчас делать проверку голосования, false может быть только лишь тогда когда предыдущая проверка ещё не завершилась
let check = true
let doubleCheck = false

//Закрывать ли вкладку после окончания голосования? Это нужно для диагностирования ошибки
let closeTabs = true

let evil
let evilProjects

let silentResponseBody = {}

//Инициализация настроек расширения
// noinspection JSIgnoredPromiseFromCall
initializeConfig(true)

//Проверка: нужно ли голосовать, сверяет время текущее с временем из конфига
async function checkVote() {

    await waitInitialize()

    //Если нет интернета, то не голосуем
    if (!settings.disabledCheckInternet && !navigator.onLine) {
        return
    }

    if (check) {
        check = false
    } else {
        doubleCheck = true
        return
    }

    const transaction = db.transaction('projects')
    let cursor = await transaction.objectStore('projects').openCursor()
    while (cursor) {
        const project = cursor.value
        if (!project.time || project.time < Date.now()) {
            await checkOpen(project, transaction)
        }
        // noinspection JSVoidFunctionReturnValueUsed
        cursor = await cursor.continue()
    }

    check = true
    if (doubleCheck) {
        doubleCheck = false
        checkVote()
    }
}

//Триггер на голосование когда подходит время голосования
chrome.alarms.onAlarm.addListener(function (alarm) {
    if (settings?.debug) console.log('chrome.alarms.onAlarm', JSON.stringify(alarm))
    // noinspection JSIgnoredPromiseFromCall
    checkVote()
})

async function reloadAllAlarms() {
    await new Promise(resolve => chrome.alarms.clearAll(resolve))
    let cursor = await db.transaction('projects').store.openCursor()
    const times = []
    while (cursor) {
        const project = cursor.value
        if (project.time != null && project.time > Date.now() && times.indexOf(project.time) === -1) {
            chrome.alarms.create(String(cursor.key), {when: project.time})
            times.push(project.time)
        }
        // noinspection JSVoidFunctionReturnValueUsed
        cursor = await cursor.continue()
    }
}

self.addEventListener('online', ()=> {
    // noinspection JSIgnoredPromiseFromCall
    checkVote()
})

let promises = []
async function checkOpen(project/*, transaction*/) {
    //Если нет подключения к интернету
    if (!settings.disabledCheckInternet && !navigator.onLine) {
        return
    }

    for (const[tab,value] of openedProjects) {
        if (value.timeoutQueue && Date.now() > value.timeoutQueue) {
            openedProjects.delete(tab)
            db.put('other', openedProjects, 'openedProjects')
            continue
        }
        if (project.rating === value.rating || (value.randomize && project.randomize) || settings.disabledOneVote) {
            if (Date.now() < value.nextAttempt) {
                return
            } else {
                console.warn(getProjectPrefix(value, true) + chrome.i18n.getMessage('timeout'))
                if (!settings.disabledNotifWarn) sendNotification(getProjectPrefix(value, false), chrome.i18n.getMessage('timeout'))
                openedProjects.delete(tab)
                db.put('other', openedProjects, 'openedProjects')
                // noinspection JSCheckFunctionSignatures
                if (closeTabs && !isNaN(tab)) {
                    tryCloseTab(tab, value, 0)
                }
                break
            }
        }
    }


    let retryCoolDown
    if (project.randomize) {
        retryCoolDown = Math.floor(Math.random() * 600000 + 1800000)
    } else if (/*project.rating === 'TopCraft' || project.rating === 'McTOP' || project.rating === 'MCRate' || (project.rating === 'MinecraftRating' && project.game === 'projects') ||*/ project.rating === 'MonitoringMinecraft' || project.rating === 'ServerPact' || project.rating === 'MinecraftIpList' || project.rating === 'MCServerList' || (project.rating === 'MisterLauncher' && project.game === 'projects')) {
        retryCoolDown = 300000
    } else {
        retryCoolDown = 900000
    }
    project.nextAttempt = Date.now() + retryCoolDown
    delete project.timeoutQueue

    openedProjects.set('start_' + project.key, project)
    db.put('other', openedProjects, 'openedProjects')

    if (settings.debug) console.log(getProjectPrefix(project, true) + 'пред запуск')

    if (project.rating === 'MonitoringMinecraft') {
        promises.push(clearMonitoringMinecraftCookies())
        async function clearMonitoringMinecraftCookies() {
            let url
            if (project.rating === 'MonitoringMinecraft') {
                url = '.monitoringminecraft.ru'
            }
            let cookies = await chrome.cookies.getAll({domain: url})
            if (settings.debug) console.log(chrome.i18n.getMessage('deletingCookies', url))
            for (let i = 0; i < cookies.length; i++) {
                if (cookies[i].domain.charAt(0) === '.') cookies[i].domain = cookies[i].domain.substring(1, cookies[i].domain.length)
                await chrome.cookies.remove({url: 'https://' + cookies[i].domain + cookies[i].path, name: cookies[i].name})
            }
        }
    }

    if (!settings.disabledUseRemoteCode && evilProjects < Date.now()) {
        evilProjects = Date.now() + 300000
        promises.push(fetchProjects())
        async function fetchProjects() {
            try {
                const response = await fetch('https://serega007ru.github.io/Auto-Vote-Rating/projects.js')
                const projects = await response.text()
                if (!evil) {
                    // noinspection JSUnresolvedVariable
                    if (!self.evalCore) {
                        importScripts('libs/evalCore.umd.js')
                    }
                    // noinspection JSUnresolvedFunction,JSUnresolvedVariable
                    evil = evalCore.getEvalInstance(self)
                }
                evil(projects)
            } catch (error) {
                console.warn(getProjectPrefix(project, true) + 'Ошибка при получении удалённого кода projects.js, использую вместо этого локальный код', error)
            }
        }
    }

    newWindow(project)
}

let promiseGroup
//Открывает вкладку для голосования или начинает выполнять fetch запросы
async function newWindow(project) {
    //Ожидаем очистку куки
    let result = await Promise.all(promises)
    while (result.length < promises.length) {
        result = await Promise.all(promises)
    }

    console.log(getProjectPrefix(project, true) + chrome.i18n.getMessage('startedAutoVote'))
    if (!settings.disabledNotifStart) sendNotification(getProjectPrefix(project, false), chrome.i18n.getMessage('startedAutoVote'))

    if (new Date(project.stats.lastAttemptVote).getMonth() < new Date().getMonth() || new Date(project.stats.lastAttemptVote).getFullYear() < new Date().getFullYear()) {
        project.stats.lastMonthSuccessVotes = project.stats.monthSuccessVotes
        project.stats.monthSuccessVotes = 0
    }
    project.stats.lastAttemptVote = Date.now()

    if (new Date(generalStats.lastAttemptVote).getMonth() < new Date().getMonth() || new Date(generalStats.lastAttemptVote).getFullYear() < new Date().getFullYear()) {
        generalStats.lastMonthSuccessVotes = generalStats.monthSuccessVotes
        generalStats.monthSuccessVotes = 0
    }
    generalStats.lastAttemptVote = Date.now()

    if (new Date(todayStats.lastAttemptVote).getDay() < new Date().getDay()) {
        todayStats = {
            successVotes: 0,
            errorVotes: 0,
            laterVotes: 0,
            lastSuccessVote: null,
            lastAttemptVote: null
        }
    }
    todayStats.lastAttemptVote = Date.now()
    await db.put('other', generalStats, 'generalStats')
    await db.put('other', todayStats, 'todayStats')
    await updateValue('projects', project)

    let create = true
    let alarms = await chrome.alarms.getAll()
    for (const alarm of alarms) {
        if (alarm.scheduledTime === project.nextAttempt) {
            create = false
            break
        }
    }
    if (create) {
        chrome.alarms.create(String(project.key), {when: project.nextAttempt})
    }

    let silentVoteMode = false
    if (project.rating === 'Custom') {
        silentVoteMode = true
    } else if (settings.enabledSilentVote) {
        if (!project.emulateMode && allProjects[project.rating].silentVote?.(project)) {
            silentVoteMode = true
        }
    } else if (project.silentMode && allProjects[project.rating].silentVote?.(project)) {
        silentVoteMode = true
    }
    if (silentVoteMode) {
        for (const [tab,value] of openedProjects) {
            if (project.key === value.key) {
                openedProjects.delete(tab)
            }
        }
        openedProjects.set('background_' + project.key, project)
        db.put('other', openedProjects, 'openedProjects')
        silentVote(project)
    } else {
        const windows = await chrome.windows.getAll()
            .catch(error => console.warn(chrome.i18n.getMessage('errorOpenTab', error.message)))
        if (windows == null || windows.length <= 0) {
            const window = await chrome.windows.create({focused: false})
            await chrome.windows.update(window.id, {focused: false})
        }

        const url = allProjects[project.rating].voteURL(project)

        let tab = await tryOpenTab({url, active: settings.disabledFocusedTab}, project, 0)
        if (tab == null) return
        for (const [tab,value] of openedProjects) {
            if (project.key === value.key) {
                openedProjects.delete(tab)
            }
        }
        openedProjects.set(tab.id, project)
        db.put('other', openedProjects, 'openedProjects')

        if (notSupportedGroupTabs) return
        await group()
        async function group() {
            if (groupId) {
                try {
                    await chrome.tabs.group({groupId, tabIds: tab.id})
                } catch (error) {
                    if (error.message.includes('No tab with id')) return
                    if (error.message.includes('No group with id')) {
                        groupId = await chrome.tabs.group({createProperties: {windowId: tab.windowId}, tabIds: tab.id})
                        await chrome.tabGroups.update(groupId, {color: 'blue', title: 'Auto Vote Rating'})
                    } else {
                        console.warn(error)
                    }
                }
            }
        }
        if (!groupId) {
            if (promiseGroup) {
                await promiseGroup
                await group()
                return
            }
            promiseGroup = createGroup()
            async function createGroup() {
                let groups
                try {
                    groups = await chrome.tabGroups.query({title: 'Auto Vote Rating'})
                } catch (error) {
                    notSupportedGroupTabs = true
                    console.warn(chrome.i18n.getMessage('notSupportedGroupTabs'), error)
                    promiseGroup = null
                    return
                }
                if (groups.length > 0) {
                    groupId = groups[0].id
                    await group()
                } else {
                    try {
                        groupId = await chrome.tabs.group({createProperties: {windowId: tab.windowId}, tabIds: tab.id})
                        await chrome.tabGroups.update(groupId, {color: 'blue', title: 'Auto Vote Rating'})
                    } catch (error) {
                        if (error.message.includes('No tab with id')) {
                            promiseGroup = null
                            return
                        }
                        notSupportedGroupTabs = true
                        console.warn(chrome.i18n.getMessage('notSupportedGroupTabs'), error)
                    }
                }
                promiseGroup = null
            }
        }
    }
}

async function silentVote(project) {
    if (!self.DOMParser) {
        importScripts('libs/linkedom.js')
    }
    try {
        if (project.rating === 'Custom') {
            let response = await fetch(project.responseURL, {...project.body})
            await response.text()
            if (response.ok) {
                endVote({successfully: true}, null, project)
            } else {
                endVote({errorVote: [String(response.status), response.url]}, null, project)
            }
            return
        }

        if (!settings.disabledUseRemoteCode) {
            try {
                const response = await fetch('https://serega007ru.github.io/Auto-Vote-Rating/scripts/' + project.rating.toLowerCase() + '_silentvote.js')
                const textScript = await response.text()
                if (!evil) {
                    // noinspection JSUnresolvedVariable
                    if (!self.evalCore) {
                        importScripts('libs/evalCore.umd.js')
                    }
                    // noinspection JSUnresolvedFunction,JSUnresolvedVariable
                    evil = evalCore.getEvalInstance(self)
                }
                evil(textScript)
            } catch (error) {
                console.warn(getProjectPrefix(project, true) + 'Ошибка при получении удалённого кода scripts/' + project.rating.toLowerCase() + '_silentvote.js, использую вместо этого локальный код', error)
            }
        }

        if (!self['silentVote' + project.rating]) {
            importScripts('scripts/' + project.rating.toLowerCase() + '_silentvote.js')
        }

        await self['silentVote' + project.rating](project)
    } catch (e) {
        if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError when attempting to fetch resource')) {
            // let found = false
            // for (const p of fetchProjects.values()) {
            //     if (p.key === project.key) {
            //         found = true
            //         break
            //     }
            // }
            // if (!found) {
                endVote({notConnectInternet: true}, null, project)
                // endVote({message: chrome.i18n.getMessage('errorVoteUnknown') + (e.stack ? e.stack : e)}, null, project)
            // }
        } else {
            let message
            if (e.stack) {
                if (!settings.disabledUseRemoteCode) {
                    message = e.toString()
                } else {
                    message = e.stack
                }
            } else {
                message = e
            }
            const request = {}
            request.errorVoteNoElement = message
            if (silentResponseBody[project.rating]) {
                request.html = silentResponseBody[project.rating].body.outerHTML
            }
            endVote(request, null, project)
        }
    } finally {
        delete silentResponseBody[project.rating]
    }
}

async function checkResponseError(project, response, url, bypassCodes, vk) {
    let host = extractHostname(response.url)
    if (vk && host.includes('vk.com')) {
        if (response.headers.get('Content-Type') && response.headers.get('Content-Type').includes('windows-1251')) {
            //Почему не UTF-8?
            response = await new Response(new TextDecoder('windows-1251').decode(await response.arrayBuffer()))
        }
    }
    response.html = await response.text()
    response.doc = new DOMParser().parseFromString(response.html, 'text/html')
    silentResponseBody[project.rating] = response.doc
    if (vk && host.includes('vk.com')) {
        //Узнаём причину почему мы зависли на авторизации ВК
        let text
        if (response.doc.querySelector('div.oauth_form_access') != null) {
            text = response.doc.querySelector('div.oauth_form_access').textContent.replace(response.doc.querySelector('div.oauth_access_items').textContent, '').trim()
        } else if (response.doc.querySelector('div.oauth_content > div') != null) {
            text = response.doc.querySelector('div.oauth_content > div').textContent
        } else if (response.doc.querySelector('#login_blocked_wrap') != null) {
            text = response.doc.querySelector('#login_blocked_wrap div.header').textContent + ' ' + response.doc.querySelector('#login_blocked_wrap div.content').textContent.trim()
        } else if (response.doc.querySelector('div.login_blocked_panel') != null) {
            text = response.doc.querySelector('div.login_blocked_panel').textContent.trim()
        } else if (response.doc.querySelector('.profile_deleted_text') != null) {
            text = response.doc.querySelector('.profile_deleted_text').textContent.trim()
        } else if (response.html.length < 500) {
            text = response.html
        } else {
            text = 'null'
        }
        endVote({errorAuthVK: text}, null, project)
        return false
    }
    if (!host.includes(url)) {
        endVote({message: chrome.i18n.getMessage('errorRedirected', response.url)}, null, project)
        return false
    }
    if (bypassCodes) {
        for (const code of bypassCodes) {
            if (response.status === code) {
                return true
            }
        }
    }
    if (!response.ok) {
        endVote({errorVote: [String(response.status), response.url]}, null, project)
        return false
    }
    if (response.statusText && response.statusText !== '' && response.statusText !== 'ok' && response.statusText !== 'OK') {
        endVote(response.statusText, null, project)
        return false
    }
    return true
}

chrome.webNavigation.onErrorOccurred.addListener(async function (details) {
    await waitInitialize()
    if (openedProjects.has(details.tabId)) {
        if (details.frameId === 0 || details.url.match(/hcaptcha.com\/captcha\/*/) || details.url.match(/https:\/\/www.google.com\/recaptcha\/*/) || details.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/*/)) {
            const project = await db.get('projects', openedProjects.get(details.tabId).key)
            if (
                //Chrome
                details.error.includes('net::ERR_ABORTED') || details.error.includes('net::ERR_CONNECTION_RESET') || details.error.includes('net::ERR_NETWORK_CHANGED') || details.error.includes('net::ERR_CACHE_MISS') || details.error.includes('net::ERR_BLOCKED_BY_CLIENT')
                //FireFox
                || details.error.includes('NS_BINDING_ABORTED') || details.error.includes('NS_ERROR_NET_ON_RESOLVED') || details.error.includes('NS_ERROR_NET_ON_RESOLVING') || details.error.includes('NS_ERROR_NET_ON_WAITING_FOR') || details.error.includes('NS_ERROR_NET_ON_CONNECTING_TO') || details.error.includes('NS_ERROR_FAILURE') || details.error.includes('NS_ERROR_DOCSHELL_DYING') || details.error.includes('NS_ERROR_NET_ON_TRANSACTION_CLOSE')) {
                // console.warn(getProjectPrefix(project, true) + details.error)
                return
            }
            const sender = {tab: {id: details.tabId}}
            endVote({errorVoteNetwork: [details.error, details.url]}, sender, project)
        }
    }
})

chrome.webNavigation.onDOMContentLoaded.addListener(async function(details) {
    if (details.url === 'about:blank') return
    await waitInitialize()
    let project = openedProjects.get(details.tabId)
    if (!project) return
    const files = []
    if (details.frameId === 0) {
        // Через эти сайты пользователь может авторизоваться, я пока не поддерживаю автоматическую авторизацию, не мешаем ему в авторизации
        if (details.url.match(/facebook.com\/*/) || details.url.match(/google.com\/*/) || details.url.match(/accounts.google.com\/*/) || details.url.match(/reddit.com\/*/) || details.url.match(/twitter.com\/*/)) {
            return
        }
        // Если пользователь авторизовывается через эти сайты, но у расширения на это нет прав, всё равно не мешаем ему, пускай сам авторизуется не смотря, на то что есть автоматизация авторизации
        if (details.url.match(/vk.com\/*/) || details.url.match(/discord.com\/*/) || details.url.startsWith('https://steamcommunity.com/openid/login')) {
            // noinspection JSUnresolvedFunction
            let granted = await chrome.permissions.contains({origins: [details.url]})
            if (!granted) {
                return
            }
        }

        files.push('scripts/main/visible.js')
        if (allProjects[projectByURL.get(getDomainWithoutSubdomain(details.url))]?.needIsTrusted?.()) {
            files.push('scripts/main/istrusted.js')
        }
    } else if (details.url.match(/hcaptcha.com\/captcha\/*/)
            || details.url.match(/https:\/\/www.google.com\/recaptcha\/api.\/anchor*/)
            || details.url.match(/https:\/\/www.google.com\/recaptcha\/api.\/bframe*/)
            || details.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/api.\/anchor*/)
            || details.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/api.\/bframe*/)
            || details.url.match(/https:\/\/www.google.com\/recaptcha\/api\/fallback*/)
            || details.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/api\/fallback*/)
            || details.url.match(/https:\/\/challenges.cloudflare.com\/*/)) {
        files.push('scripts/main/visible.js')
    }

    if (files.length === 0) return

    try {
        if (details.frameId === 0) {
            // noinspection JSCheckFunctionSignatures
            await chrome.scripting.executeScript({target: {tabId: details.tabId}, files, world: 'MAIN', injectImmediately: true})
        } else {
            // noinspection JSCheckFunctionSignatures
            await chrome.scripting.executeScript({target: {tabId: details.tabId, frameIds: [details.frameId]}, files, world: 'MAIN', injectImmediately: true})
        }
    } catch (error) {
        if (error.message !== 'The tab was closed.' && !error.message.includes('PrecompiledScript.executeInGlobal') && !error.message.includes('Could not establish connection. Receiving end does not exist') && !error.message.includes('The message port closed before a response was received') && (!error.message.includes('Frame with ID') && !error.message.includes('was removed'))) {
            project = await db.get('projects', project.key)
            console.error(getProjectPrefix(project, true), error)
            if (!settings.disabledNotifError) sendNotification(getProjectPrefix(project, false), error.message, 'openProject_' + project.key)
            project.error = error.message
            updateValue('projects', project)
        }
    }
})

//Слушатель на обновление вкладок, если вкладка полностью загрузилась, загружает туда скрипт который сам нажимает кнопку проголосовать
chrome.webNavigation.onCompleted.addListener(async function(details) {
    await waitInitialize()
    let project = openedProjects.get(details.tabId)
    if (!project) return
    if (details.frameId === 0) {
        // Через эти сайты пользователь может авторизоваться, я пока не поддерживаю автоматическую авторизацию, не мешаем ему в авторизации
        if (details.url.match(/facebook.com\/*/) || details.url.match(/google.com\/*/) || details.url.match(/accounts.google.com\/*/) || details.url.match(/reddit.com\/*/) || details.url.match(/twitter.com\/*/)) {
            return
        }

        // Если пользователь авторизовывается через эти сайты, но у расширения на это нет прав, всё равно не мешаем ему, пускай сам авторизуется не смотря, на то что есть автоматизация авторизации
        if (details.url.match(/vk.com\/*/) || details.url.match(/discord.com\/*/) || details.url.startsWith('https://steamcommunity.com/openid/login')) {
            // noinspection JSUnresolvedFunction
            let granted = await chrome.permissions.contains({origins: [details.url]})
            if (!granted) {
                console.warn(getProjectPrefix(project, true) + 'Not granted permissions for ' + details.url)
                return
            }
        }

        let eval = true
        let textApi, textScript, textWorld
        if (!settings.disabledUseRemoteCode) {
            try {
                const responseApi = await fetch('https://serega007ru.github.io/Auto-Vote-Rating/scripts/main/api.js')
                textApi = await responseApi.text()
                const responseScript = await fetch('https://serega007ru.github.io/Auto-Vote-Rating/scripts/' + project.rating.toLowerCase() + '.js')
                textScript = await responseScript.text()
                // noinspection JSUnresolvedVariable,JSUnresolvedFunction
                if (allProjects[project.rating]?.needWorld?.()) {
                    const responseWorld = await fetch('https://serega007ru.github.io/Auto-Vote-Rating/scripts/' + project.rating.toLowerCase() + '_world.js')
                    textWorld = await responseWorld.text()
                }
            } catch (error) {
                console.warn(getProjectPrefix(project, true) + 'Ошибка при получении удалённого кода, использую вместо этого локальный код', error)
                eval = false
            }
        } else {
            eval = false
        }

        try {
            if (allProjects[project.rating]?.needPrompt?.()) {
                const funcPrompt = function(nick) {
                    prompt = function() {
                        return nick
                    }
                }
                await chrome.scripting.executeScript({target: {tabId: details.tabId}, world: 'MAIN', func: funcPrompt, args: [project.nick]})
            }

            if (eval) {
                await chrome.scripting.executeScript({target: {tabId: details.tabId}, files: ['libs/evalCore.umd.js', 'scripts/main/injectEval.js']})
                await chrome.tabs.sendMessage(details.tabId, {textEval: true, textApi, textScript})
                // noinspection JSUnresolvedVariable,JSUnresolvedFunction
                if (allProjects[project.rating]?.needWorld?.()) {
                    await chrome.scripting.executeScript({target: {tabId: details.tabId}, world: 'MAIN', files: ['libs/evalCore.umd.js']})
                    const funcWorld = function(text) {
                        // noinspection JSUnresolvedFunction,JSUnresolvedVariable
                        const evil = evalCore.getEvalInstance(window)
                        evil(text)
                    }
                    await chrome.scripting.executeScript({target: {tabId: details.tabId}, world: 'MAIN', func: funcWorld, args: [textWorld]})
                }
            } else {
                await chrome.scripting.executeScript({target: {tabId: details.tabId}, files: ['scripts/' + project.rating.toLowerCase() +'.js', 'scripts/main/api.js']})
                // noinspection JSUnresolvedVariable,JSUnresolvedFunction
                if (allProjects[project.rating]?.needWorld?.()) {
                    await chrome.scripting.executeScript({target: {tabId: details.tabId}, world: 'MAIN', files: ['scripts/' + project.rating.toLowerCase() +'_world.js']})
                }
            }

            await chrome.tabs.sendMessage(details.tabId, {sendProject: true, project})
        } catch (error) {
            if (error.message !== 'The tab was closed.' && !error.message.includes('PrecompiledScript.executeInGlobal') && !error.message.includes('Could not establish connection. Receiving end does not exist') && !error.message.includes('The message port closed before a response was received') && (!error.message.includes('Frame with ID') && !error.message.includes('was removed'))) {
                project = await db.get('projects', project.key)
                console.error(getProjectPrefix(project, true), error)
                if (!settings.disabledNotifError) sendNotification(getProjectPrefix(project, false), error.message, 'openProject_' + project.key)
                project.error = error.message
                updateValue('projects', project)
            }
        }
    } else if (details.frameId !== 0 && (
        details.url.match(/hcaptcha.com\/captcha\/*/)
        || details.url.match(/https:\/\/www.google.com\/recaptcha\/api.\/anchor*/)
        || details.url.match(/https:\/\/www.google.com\/recaptcha\/api.\/bframe*/)
        || details.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/api.\/anchor*/)
        || details.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/api.\/bframe*/)
        || details.url.match(/https:\/\/www.google.com\/recaptcha\/api\/fallback*/)
        || details.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/api\/fallback*/)
        || details.url.match(/https:\/\/challenges.cloudflare.com\/*/))) {

        // let eval = true
        // let textCaptcha
        // if (!settings.disabledUseRemoteCode) {
        //     try {
        //         const responseApi = await fetch('https://serega007ru.github.io/Auto-Vote-Rating/scripts/main/captchaclicker.js')
        //         textCaptcha = await responseApi.text()
        //     } catch (error) {
        //         console.warn(getProjectPrefix(project, true) + 'Ошибка при получении удалённого кода scripts/main/captchaclicker.js, использую вместо этого локальный код', error)
        //         eval = false
        //     }
        // } else {
        //     eval = false
        // }

        try {
            // if (eval) {
            //     await chrome.scripting.executeScript({target: {tabId: details.tabId, frameIds: [details.frameId]}, files: ['libs/evalCore.umd.js', 'scripts/main/injectEval.js']})
            //     await chrome.tabs.sendMessage(details.tabId, {textEval: true, textCaptcha})
            // } else {
                await chrome.scripting.executeScript({target: {tabId: details.tabId, frameIds: [details.frameId]}, files: ['scripts/main/captchaclicker.js']})
            // }

            // Если вкладка уже загружена, повторно туда высылаем sendProject который обозначает что мы готовы к голосованию
            const tab = await chrome.tabs.get(details.tabId)
            if (tab.status !== 'complete') return
            await chrome.tabs.sendMessage(details.tabId, {sendProject: true, project})
        } catch (error) {
            if (error.message !== 'The frame was removed.' && !error.message.includes('No frame with id') && !error.message.includes('PrecompiledScript.executeInGlobal')/*Для FireFox мы игнорируем эту ошибку*/ && !error.message.includes('Could not establish connection. Receiving end does not exist') && !error.message.includes('The message port closed before a response was received') && (!error.message.includes('Frame with ID') && !error.message.includes('was removed'))) {
                project = await db.get('projects', project.key)
                error = error.message
                if (error.includes('This page cannot be scripted due to an ExtensionsSettings policy')) {
                    error += ' Try this solution: https://github.com/Serega007RU/Auto-Vote-Rating/wiki/Problems-with-Opera'
                }
                console.error(getProjectPrefix(project, true), error)
                if (!settings.disabledNotifError) sendNotification(getProjectPrefix(project, false), error.message, 'openProject_' + project.key)
                project.error = error
                updateValue('projects', project)
            }
        }
    }
})

chrome.tabs.onRemoved.addListener(async function(tabId) {
    await waitInitialize()
    let project = openedProjects.get(tabId)
    if (!project) return
    project = await db.get('projects', project.key)
    endVote({closedTab: true}, {tab: {id: tabId}}, project)
})

// TODO к сожалению в manifest v3 не возможно узнать status code страницы, не знаю как это ещё сделать
// chrome.webRequest.onCompleted.addListener(async function(details) {
//     await waitInitialize()
//     let project = openedProjects.get(details.tabId)
//     if (!project) return
//     project = await db.get('projects', project.key)
//
//     // TODO это какой-то кринж для https://www.minecraft-serverlist.net/, ошибка 500 считается как успешный запрос https://discord.com/channels/371699266747629568/760393040174120990/1053016256535593022
//     if (project.rating === 'MinecraftServerListNet') return
//
//     if (details.type === 'main_frame' && (details.statusCode < 200 || details.statusCode > 299) && details.statusCode !== 503 && details.statusCode !== 403/*Игнорируем проверку CloudFlare*/) {
//         const sender = {tab: {id: details.tabId}}
//         endVote({errorVote: [String(details.statusCode), details.url]}, sender, project)
//     }
// }, {urls: ['<all_urls>']})
//
// chrome.webRequest.onErrorOccurred.addListener(async function(details) {
//     await waitInitialize()
//     // noinspection JSUnresolvedVariable
//     if ((details.initiator && details.initiator.includes(self.location.hostname) || (details.originUrl && details.originUrl.includes(self.location.hostname))) && fetchProjects.has(details.requestId)) {
//         let project = fetchProjects.get(details.requestId)
//         endVote({errorVoteNetwork: [details.error, details.url]}, null, project)
//     } else if (openedProjects.has(details.tabId)) {
//         if (details.type === 'main_frame' || details.url.match(/hcaptcha.com\/captcha\/*/) || details.url.match(/https:\/\/www.google.com\/recaptcha\/*/) || details.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/*/)) {
//             const project = await db.get('projects', openedProjects.get(details.tabId).key)
//             if (
//                 //Chrome
//                 details.error.includes('net::ERR_ABORTED') || details.error.includes('net::ERR_CONNECTION_RESET') || details.error.includes('net::ERR_NETWORK_CHANGED') || details.error.includes('net::ERR_CACHE_MISS') || details.error.includes('net::ERR_BLOCKED_BY_CLIENT')
//                 //FireFox
//                 || details.error.includes('NS_BINDING_ABORTED') || details.error.includes('NS_ERROR_NET_ON_RESOLVED') || details.error.includes('NS_ERROR_NET_ON_RESOLVING') || details.error.includes('NS_ERROR_NET_ON_WAITING_FOR') || details.error.includes('NS_ERROR_NET_ON_CONNECTING_TO') || details.error.includes('NS_ERROR_FAILURE') || details.error.includes('NS_ERROR_DOCSHELL_DYING') || details.error.includes('NS_ERROR_NET_ON_TRANSACTION_CLOSE')) {
//                     // console.warn(getProjectPrefix(project, true) + details.error)
//                     return
//             }
//             const sender = {tab: {id: details.tabId}}
//             endVote({errorVoteNetwork: [details.error, details.url]}, sender, project)
//         }
//     }
// }, {urls: ['<all_urls>']})
//
// async function _fetch(url, options, project) {
//     let listener
//     const removeListener = ()=>{
//         if (listener) {
//             chrome.webRequest.onBeforeRequest.removeListener(listener)
//             listener = null
//         }
//     }
//
//     listener = (details)=>{
//         //Да это костыль, а есть другой адекватный вариант достать requestId или хотя бы код ошибки net::ERR из fetch запроса?
//         // noinspection JSUnresolvedVariable
//         if ((details.initiator && details.initiator.includes(self.location.hostname) || (details.originUrl && details.originUrl.includes(self.location.hostname))) && details.url.includes(url)) {
//             fetchProjects.set(details.requestId, project)
//             removeListener()
//         }
//     }
//     chrome.webRequest.onBeforeRequest.addListener(listener, {urls: ['<all_urls>']})
//
//     if (!options) options = {}
//
//     try {
//         return await fetch(url, options)
//     } catch(e) {
//         throw e
//     } finally {
//         removeListener()
//     }
// }

//Слушатель сообщений и ошибок
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // noinspection JSIgnoredPromiseFromCall
    onRuntimeMessage(request, sender, sendResponse)
    if (request.projectDeleted || request.projectRestart) {
        return true
    }
})

async function onRuntimeMessage(request, sender, sendResponse) {
    if (request === 'reloadCaptcha') {
        // noinspection JSVoidFunctionReturnValueUsed,JSCheckFunctionSignatures
        const frames = await chrome.webNavigation.getAllFrames({tabId: sender.tab.id})
        for (const frame of frames) {
            // noinspection JSUnresolvedVariable
            if (frame.url.match(/https:\/\/www.google.com\/recaptcha\/api\d\/anchor/) || frame.url.match(/https:\/\/www.recaptcha.net\/recaptcha\/api\d\/anchor/)) {
                function reload() {
                    document.location.reload()
                }

                // noinspection JSCheckFunctionSignatures,JSUnresolvedVariable
                await chrome.scripting.executeScript({target: {tabId: sender.tab.id, frameIds: [frame.frameId]}, func: reload})
            }
        }
        return
    } else if (request === 'captchaPassed') {
        try {
            await chrome.tabs.sendMessage(sender.tab.id, 'captchaPassed')
        } catch (error) {
            if (!error.message.includes('Could not establish connection. Receiving end does not exist') && !error.message.includes('The message port closed before a response was received')) {
                console.warn(error)
            }
        }
        return
    }

    await waitInitialize()

    if (request === 'checkVote') {
        checkVote()
        return
    } else if (request === 'reloadAllSettings') {
        settings = await db.get('other', 'settings')
        generalStats = await db.get('other', 'generalStats')
        todayStats = await db.get('other', 'todayStats')
        openedProjects = await db.get('other', 'openedProjects')
        reloadAllAlarms()
        checkVote()
        return
    } else if (request === 'reloadSettings') {
        settings = await db.get('other', 'settings')
        return
    } else if (request.projectDeleted) {
        let nowVoting = false
        //Если эта вкладка была уже открыта, он закрывает её
        for (const[key,value] of openedProjects) {
            if (request.projectDeleted.key === value.key) {
                if (key === 'start_' + request.projectDeleted.key) {
                    sendResponse('reject')
                    return
                }
                nowVoting = true
                openedProjects.delete(key)
                // noinspection JSCheckFunctionSignatures
                if (!isNaN(key)) { // noinspection JSCheckFunctionSignatures
                    chrome.tabs.remove(key)
                        .catch(error => {if (!error.message.includes('No tab with id')) console.warn(error)})
                }
                await db.put('other', openedProjects, 'openedProjects')
                break
            }
        }
        await db.delete('projects', request.projectDeleted.key)
        await chrome.alarms.clear(String(request.projectDeleted.key))
        if (nowVoting) {
            checkVote()
            console.log(getProjectPrefix(request.projectDeleted, true) + chrome.i18n.getMessage('projectDeleted'))
        }
        sendResponse('success')
        return
    } else if (request.projectRestart) {
        let inQueue = false
        for (const[key,value] of openedProjects) {
            if (settings.disabledOneVote) {
                sendResponse('inQueue')
                return
            }
            if (request.projectRestart.key === value.key) {
                if (request.confirmed) {
                    openedProjects.delete(key)
                    // noinspection JSCheckFunctionSignatures
                    if (!isNaN(key)) { // noinspection JSCheckFunctionSignatures
                        chrome.tabs.remove(key)
                            .catch(error => {if (!error.message.includes('No tab with id')) console.warn(error)})
                    }
                    await db.put('other', openedProjects, 'openedProjects')
                    break
                } else {
                    sendResponse('needConfirm')
                    return
                }
            } else if (request.projectRestart.rating === value.rating) {
                inQueue = true
            }
        }
        if (inQueue) {
            sendResponse('inQueue')
            return
        }
        await chrome.alarms.clear(String(request.projectRestart.key))
        request.projectRestart.time = null
        await db.put('projects', request.projectRestart, request.projectRestart.key)
        console.log(getProjectPrefix(request.projectRestart, true) + chrome.i18n.getMessage('projectRestarted'))
        checkVote()
        sendResponse('success')
        return
    }

    if (request.changeProject) {
        updateValue('projects', request.changeProject)
        return
    }

    if (!openedProjects.has(sender.tab.id)) {
        console.warn('Пришёл нераспознанный chrome.runtime.message, что это?' + JSON.stringify(request))
        return
    }
    const project = await db.get('projects', openedProjects.get(sender.tab.id).key)
    if (request.captcha || request.authSteam || request.discordLogIn || request.auth) {//Если требует ручное прохождение капчи
        let message
        if (request.captcha) {
            if (settings.disabledWarnCaptcha) return
            message = chrome.i18n.getMessage('requiresCaptcha')
        } else if (request.auth && request.auth !== true) {
            message = request.auth
        } else {
            message = chrome.i18n.getMessage(Object.keys(request)[0])
        }
        console.warn(getProjectPrefix(project, true) + message)
        if (!settings.disabledNotifWarn) sendNotification(getProjectPrefix(project, false), message, 'openTab_' + sender.tab.id)
        project.error = message
        // delete project.nextAttempt
        updateValue('projects', project)
    } else if (request.errorCaptcha && !request.restartVote) {
        const message = chrome.i18n.getMessage('errorCaptcha', request.errorCaptcha)
        console.warn(getProjectPrefix(project, true) + message)
        if (!settings.disabledNotifWarn) sendNotification(getProjectPrefix(project, false), message, 'openTab_' + sender.tab.id)
        project.error = message
        updateValue('projects', project)
    } else {
        endVote(request, sender, project)
    }
}

async function tryOpenTab(request, project, attempt) {
    try {
        return await chrome.tabs.create(request)
    } catch (error) {
        if (error.message === 'Tabs cannot be edited right now (user may be dragging a tab).' && attempt < 3) {
            await wait(500)
            return await tryOpenTab(request, project, ++attempt)
        }
        endVote({errorOpenTab: error.message}, null, project)
        return null
    }
}

async function tryCloseTab(tabId, project, attempt) {
    try {
        await chrome.tabs.remove(tabId)
    } catch (error) {
        if (error.message === 'Tabs cannot be edited right now (user may be dragging a tab).' && attempt < 3) {
            await wait(500)
            await tryCloseTab(tabId, project, ++attempt)
            return
        }
        if (!error.message.includes('No tab with id')) {
            console.warn(getProjectPrefix(project, true) + error)
            if (!settings.disabledNotifError) sendNotification(getProjectPrefix(project, false), error.message, 'openProject_' + project.key)
        }
    }
}

//Завершает голосование, если есть ошибка то обрабатывает её
async function endVote(request, sender, project) {
    for (const [tab,value] of openedProjects) {
        if (project.key === value.key) {
            // noinspection JSCheckFunctionSignatures
            if (isNaN(tab) && !tab.startsWith('background_')) {
                return
            } else {
                openedProjects.delete(tab)
                openedProjects.set('queue_' + project.key, project)
            }
            break
        }
    }

    if (!settings.disabledSendErrorSentry && !request.ignoreReport && (request.message != null || request.errorVoteNoElement || request.emptyError)) {
        try {
            await reportError(request, sender, project)
        } catch (error) {
            console.warn(getProjectPrefix(project, true) + 'Ошибка отправки отчёта об ошибке', error)
        } finally {
            if (closeTabs && !request.closedTab) {
                tryCloseTab(sender.tab.id, project, 0)
            }
        }
    } else {
        if (sender && closeTabs && !request.closedTab) {
            tryCloseTab(sender.tab.id, project, 0)
        }
    }

    // for (const[key,value] of fetchProjects) {
    //     if (value.key === project.key) {
    //         fetchProjects.delete(key)
    //     }
    // }

    delete project.nextAttempt
    delete project.timeoutQueue

    //Если усё успешно
    let sendMessage
    if (request.successfully || request.later != null) {
        let time = new Date()
        if (project.rating !== 'Custom' && (project.timeout != null || project.timeoutHour != null) && !(project.lastDayMonth && new Date(time.getFullYear(), time.getMonth(), time.getDay() + 1).getMonth() === new Date().getMonth())) {
            if (project.timeoutHour != null) {
                if (project.timeoutMinute == null) project.timeoutMinute = 0
                if (project.timeoutSecond == null) project.timeoutSecond = 0
                if (project.timeoutMS == null) project.timeoutMS = 0
                if (time.getHours() > project.timeoutHour || (time.getHours() === project.timeoutHour && time.getMinutes() >= project.timeoutMinute)) {
                    time.setDate(time.getDate() + 1)
                }
                time.setHours(project.timeoutHour, project.timeoutMinute, project.timeoutSecond, project.timeoutMS)
            } else {
                time.setUTCMilliseconds(time.getUTCMilliseconds() + project.timeout)
            }
        } else if (request.later && Number.isInteger(request.later)) {
            time = new Date(request.later)
            if (project.rating === 'ServeurPrive' || project.rating === 'TopGames' || project.rating === 'MCServerList' || project.rating === 'CzechCraft' || project.rating === 'MinecraftServery' || project.rating === 'MinecraftListCZ' || project.rating === 'ListeServeursMinecraft' || project.rating === 'ServeursMCNet' || project.rating === 'ServeursMinecraftCom' || request.rating === 'ServeurMinecraftVoteFr' || request.rating === 'ListeServeursFr') {
                project.countVote = project.countVote + 1
                if (project.countVote >= project.maxCountVote) {
                    time = new Date()
                    time.setDate(time.getDate() + 1)
                    time.setHours(0, (project.priority ? 0 : 10), 0, 0)
                }
            }
        } else {
            //Рейтинги с таймаутом сбрасывающемся раз в день в определённый час
            let hour
            if (project.rating === 'TopCraft' || project.rating === 'McTOP' || (project.rating === 'MinecraftRating' && project.game === 'projects') || project.rating === 'MonitoringMinecraft' || project.rating === 'IonMc' || (project.rating === 'MisterLauncher' && project.game === 'projects')) {
                //Топы на которых время сбрасывается в 00:00 по МСК
                hour = 21
            } else if (project.rating === 'MCRate') {
                hour = 22
            } else if (project.rating === 'MinecraftServerList' || project.rating === 'ServerList101' || project.rating === 'MinecraftServerListNet' || project.rating === 'MinecraftServerEu') {
                hour = 23
            } else if (project.rating === 'PlanetMinecraft' || project.rating === 'ListForge' || project.rating === 'MinecraftList') {
                hour = 5
            } else if (project.rating === 'MinecraftServersOrg' || project.rating === 'MinecraftIndex' || project.rating === 'MinecraftBuzz' || project.rating === 'MineServers') {
                hour = 0
            } else if (project.rating === 'TopMinecraftServers') {
                hour = 4
            } else if (project.rating === 'MMoTopRU') {
                hour = 20
            }
            if (hour != null) {
                if (time.getUTCHours() >= hour/* || (time.getUTCHours() === hour && time.getUTCMinutes() >= (project.priority ? 0 : 10))*/) {
                    time.setUTCDate(time.getUTCDate() + 1)
                }
                time.setUTCHours(hour, (project.priority ? 0 : 10), 0, 0)
            //Рейтинги с таймаутом сбрасывающемся через определённый промежуток времени с момента последнего голосования
            } else if (project.rating === 'TopG' || project.rating === 'MinecraftServersBiz' || project.rating === 'TopGG' || project.rating === 'DiscordBotList' || project.rating === 'MCListsOrg' || (project.rating === 'Discords' && project.game === 'bots/bot') || project.rating === 'DiscordBoats' || project.rating === 'McServerTimeCom') {
                time.setUTCHours(time.getUTCHours() + 12)
            } else if (project.rating === 'MinecraftIpList' || project.rating === 'HotMC' || project.rating === 'MinecraftServerNet' || project.rating === 'TMonitoring' || project.rating === 'MCServers' || project.rating === 'CraftList' || project.rating === 'TopMCServersCom' || project.rating === 'CraftListNet' || project.rating === 'MinecraftServers100' || project.rating === 'MineStatus' || project.rating === 'MinecraftServersDe' || (project.rating === 'MinecraftRating' && project.game === 'servers') || (project.rating === 'MisterLauncher' && project.game === 'servers') || project.rating === 'ATLauncher' || project.rating === 'MCServidores' || project.rating === 'MinecraftServerSk' || project.rating === 'ServeursMinecraftOrg') {
                time.setUTCDate(time.getUTCDate() + 1)
            } else if (project.rating === 'ServeurPrive' || project.rating === 'TopGames' || project.rating === 'MCServerList' || project.rating === 'CzechCraft' || project.rating === 'MinecraftServery' || project.rating === 'MinecraftListCZ' || project.rating === 'ListeServeursMinecraft' || project.rating === 'ServeursMCNet' || project.rating === 'ServeursMinecraftCom' || project.rating === 'ServeurMinecraftVoteFr' || project.rating === 'ListeServeursFr') {
                project.countVote = project.countVote + 1
                if (project.countVote >= project.maxCountVote) {
                    time.setDate(time.getDate() + 1)
                    time.setHours(0, (project.priority ? 0 : 10), 0, 0)
                    project.countVote = 0
                } else {
                    if (project.rating === 'ServeurPrive' || project.rating === 'ServeurMinecraftVoteFr') {
                        time.setUTCHours(time.getUTCHours() + 1, time.getUTCMinutes() + 30)
                    } else if (project.rating === 'ListeServeursMinecraft' || project.rating === 'ServeursMinecraftCom' || project.rating === 'ListeServeursFr') {
                        time.setUTCHours(time.getUTCHours() + 3)
                    } else {
                        time.setUTCHours(time.getUTCHours() + 2)
                    }
                }
            } else if (project.rating === 'ServerPact') {
                time.setUTCHours(time.getUTCHours() + 11)
                time.setUTCMinutes(time.getUTCMinutes() + 7)
            } else if (project.rating === 'Custom') {
                if (project.timeoutHour != null) {
                    if (project.timeoutMinute == null) project.timeoutMinute = 0
                    if (project.timeoutSecond == null) project.timeoutSecond = 0
                    if (project.timeoutMS == null) project.timeoutMS = 0
                    if (time.getHours() > project.timeoutHour || (time.getHours() === project.timeoutHour && time.getMinutes() >= project.timeoutMinute)) {
                        time.setDate(time.getDate() + 1)
                    }
                    time.setHours(project.timeoutHour, project.timeoutMinute, project.timeoutSecond, project.timeoutMS)
                } else {
                    time.setUTCMilliseconds(time.getUTCMilliseconds() + project.timeout)
                }
            } else if (project.rating === 'CraftList') {
                time = new Date(request.successfully)
            } else if (project.rating === 'Discords' && project.game === 'servers') {
                time.setUTCHours(time.getUTCHours() + 6)
            } else if (project.rating === 'WARGM') {
                time.setUTCHours(time.getUTCHours() + 16)
            } else if (project.rating === 'ServerListGames') {
                time.setUTCHours(time.getUTCHours() + 20)
            } else {
                time.setUTCDate(time.getUTCDate() + 1)
            }
        }

        time = time.getTime()
        project.time = time

        if (project.randomize) {
            if (project.randomize.min == null) {
                project.randomize = {}
                project.randomize.min = 0
                project.randomize.max = 43200000
            }
            project.time = project.time + Math.floor(Math.random() * (project.randomize.max - project.randomize.min) + project.randomize.min)
        } else if ((project.rating === 'TopCraft' || project.rating === 'McTOP' || (project.rating === 'MinecraftRating' && project.game === 'projects')) && !project.priority && project.timeoutHour == null) {
            //Рандомизация по умолчанию (в пределах 5-10 минут) для бедного TopCraft/McTOP который легко ддосится от массового автоматического голосования
            project.time = project.time + Math.floor(Math.random() * (600000 - 300000) + 300000)
        }

        delete project.error

        if (request.successfully) {
            sendMessage = chrome.i18n.getMessage('successAutoVote')
            if (!settings.disabledNotifInfo) sendNotification(getProjectPrefix(project, false), sendMessage, 'openProject_' + project.key)

            project.stats.successVotes++
            project.stats.monthSuccessVotes++
            project.stats.lastSuccessVote = Date.now()

            generalStats.successVotes++
            generalStats.monthSuccessVotes++
            generalStats.lastSuccessVote = Date.now()
            todayStats.successVotes++
            todayStats.lastSuccessVote = Date.now()
        } else {
            sendMessage = chrome.i18n.getMessage('alreadyVoted')
//          if (typeof request.later == 'string') sendMessage = sendMessage + ' ' + request.later
            if (!settings.disabledNotifWarn) sendNotification(getProjectPrefix(project, false), sendMessage, 'openProject_' + project.key)

            project.stats.laterVotes++

            generalStats.laterVotes++
            todayStats.laterVotes++
        }
        console.log(getProjectPrefix(project, true) + sendMessage + ', ' + chrome.i18n.getMessage('timeStamp') + ' ' + project.time)
        //Если ошибка
    } else {
        let message
        if (!request.message) {
            if (Object.values(request)[0] === true) {
                message = chrome.i18n.getMessage(Object.keys(request)[0])
            } else {
                message = chrome.i18n.getMessage(Object.keys(request)[0], Object.values(request)[0])
            }
        } else {
            message = request.message
        }
        if (message.length === 0) message = chrome.i18n.getMessage('emptyError')
        let retryCoolDown
        if ((request.errorVote && request.errorVote[0] === '404') || (request.message && project.rating === 'WARGM' && project.randomize)) {
            retryCoolDown = 21600000
        } else if (request.closedTab) {
            retryCoolDown = 60000
        } else {
            retryCoolDown = settings.timeoutError
        }

        sendMessage = message + '. ' + chrome.i18n.getMessage('errorNextVote', (Math.round(retryCoolDown / 1000 / 60 * 100) / 100).toString())

        if (project.randomize) {
            retryCoolDown = retryCoolDown + Math.floor(Math.random() * 900000)
        }
        project.time = Date.now() + retryCoolDown
        project.error = message
        console.error(getProjectPrefix(project, true) + sendMessage + ', ' + chrome.i18n.getMessage('timeStamp') + ' ' + project.time)
        if (!settings.disabledNotifError && !(request.errorVote && request.errorVote[0].charAt(0) === '5')) sendNotification(getProjectPrefix(project, false), sendMessage, 'openProject_' + project.key)

        project.stats.errorVotes++

        generalStats.errorVotes++
        todayStats.errorVotes++
    }

    let timeout = settings.timeout
    if (project.randomize) {
        timeout += Math.floor(Math.random() * (60000 - 10000) + 10000)
    }
    project.timeoutQueue = timeout

    await db.put('other', generalStats, 'generalStats')
    await db.put('other', todayStats, 'todayStats')
    await updateValue('projects', project)

    await chrome.alarms.clear(String(project.key))
    if (project.time != null && project.time > Date.now()) {
        let create2 = true
        const alarms = await chrome.alarms.getAll()
        for (const alarm of alarms) {
            if (alarm.scheduledTime === project.time) {
                create2 = false
                break
            }
        }
        if (create2) {
            chrome.alarms.create(String(project.key), {when: project.time})
        }
    }

    async function removeQueue() {
        for (const [tab,value] of openedProjects) {
            // noinspection JSCheckFunctionSignatures
            if (isNaN(tab) && tab.startsWith('queue_') && project.key === value.key) {
                openedProjects.delete(tab)
            }
        }
        project = await db.get('projects', project.key)
        if (project) {
            delete project.timeoutQueue
            updateValue('projects', project)
        }
        db.put('other', openedProjects, 'openedProjects')
        if (openedProjects.size === 0) {
            promises = []
        }
        checkVote()
    }

    setTimeout(()=>{
        removeQueue()
    }, timeout)

    // TODO мы не можем быть уверены что setTimeout в Service Worker 100% отработает, поэтому мы на всякий случай создаём chrome.alarm
    let alarmTimeout = timeout
    if (alarmTimeout < 60000) alarmTimeout = 60000
    chrome.alarms.create('checkVote', {when: Date.now() + alarmTimeout})
}


async function reportError(request, sender, project) {
    const reported = await db.get('other', 'sentryReported')
    if (reported?.[project.rating] > Date.now()) return

    let tabDetails
    if (sender) {
        try {
            await chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['libs/html-to-image.umd.js', 'scripts/main/report.js']})
            tabDetails = await chrome.tabs.sendMessage(sender.tab.id, {generateReport: true})
            if (!tabDetails.screenshotError) tabDetails.screenshot = new Uint8Array(await convertBase64ToBlob(tabDetails.screenshot).arrayBuffer())
        } catch (error) {
            if (error.message !== 'The tab was closed.' && !error.message.includes('PrecompiledScript.executeInGlobal') && !error.message.includes('Could not establish connection. Receiving end does not exist') && !error.message.includes('The message port closed before a response was received') && (!error.message.includes('Frame with ID') && !error.message.includes('was removed'))) {
                console.warn(getProjectPrefix(project, true) + 'Ошибка получении скриншота вкладки для отправки отчёта об ошибке', error)
            }
        }
    }

    if (!tabDetails || !request.html) return

    sendReport(request, sender, tabDetails, project, reported)
}

async function sendReport(request, sender, tabDetails, project, reported) {
    let titleError = project.rating + ' '
    let detailsError
    if (request.message != null) {
        if (typeof request.message === 'string' && request.message.length > 0) {
            titleError = titleError + request.message
        } else if (typeof request.message === 'object') {
            titleError = titleError + JSON.stringify(request.message)
        } else {
            titleError = titleError + 'Empty error'
        }
    } else if (request.errorVoteNoElement) {
        titleError = titleError + 'No element'
        detailsError = request.errorVoteNoElement
    } else if (request.emptyError) {
        titleError = titleError + 'Empty error'
    }

    const eventId = uuidv4()
    const date = new Date()
    const message1 = {}
    message1.event_id = eventId
    message1.sent_at = date.toISOString()
    const message2 = {type: 'event'}
    const message3 = {}
    message3.message = titleError
    message3.level = 'error'
    message3.event_id = uuidv4()
    message3.platform = 'javascript'
    message3.timestamp = date.getTime() / 1000
    message3.environment = 'Auto-Vote-Rating@' + chrome.runtime.getManifest().version
    message3.extra = {}
    if (detailsError) message3.extra.detailsError = detailsError
    message3.extra.project = project
    message3.extra.settings = settings
    message3.request = {headers: {'User-Agent': self.navigator.userAgent}}
    if (sender?.url) {
        message3.request.url = sender.url
    } else {
        message3.request.url = 'chrome-extension://mdfmiljoheedihbcfiifopgmlcincadd/background.js'
    }
    let body = JSON.stringify(message1) + '\n' + JSON.stringify(message2) + '\n' + JSON.stringify(message3)

    if (!tabDetails && request.html) {
        tabDetails = {html: request.html}
    }

    // Да тут полный кринж, работа с байтами крайне убога, но мы работаем с тем чем имеем
    if (tabDetails) {
        let documentArrayHead
        let documentArrayBody
        let documentArray

        let screenshotArrayHead
        let screenshotArrayBody
        let screenshotArray

        let enc = new TextEncoder()

        const attachmentHTML = {}
        documentArrayBody = enc.encode(tabDetails.html)
        attachmentHTML.type = 'attachment'
        attachmentHTML.length = documentArrayBody.length
        attachmentHTML.filename = 'document.html'
        documentArrayHead = enc.encode('\n' + JSON.stringify(attachmentHTML) + '\n')
        documentArray = new Uint8Array(documentArrayHead.length + documentArrayBody.length)
        documentArray.set(documentArrayHead)
        documentArray.set(documentArrayBody, documentArrayHead.length)

        let newBody = enc.encode(body)
        let newBody2 = new Uint8Array(newBody.length + documentArray.length)
        newBody2.set(newBody)
        newBody2.set(documentArray, newBody.length)

        if (tabDetails.screenshot || tabDetails.screenshotError) {
            const attachmentScreenshot = {}
            screenshotArrayBody = tabDetails.screenshotError ? enc.encode(tabDetails.screenshotError) : tabDetails.screenshot
            attachmentScreenshot.type = 'attachment'
            attachmentScreenshot.length = screenshotArrayBody.length
            attachmentScreenshot.filename = tabDetails.screenshotError ? 'screenshot.txt' : 'screenshot.png'
            screenshotArrayHead = enc.encode('\n' + JSON.stringify(attachmentScreenshot) + '\n')
            screenshotArray = new Uint8Array(screenshotArrayHead.length + screenshotArrayBody.length)
            screenshotArray.set(screenshotArrayHead)
            screenshotArray.set(screenshotArrayBody, screenshotArrayHead.length)

            let newBody3 = new Uint8Array(newBody2.length + screenshotArray.length)
            newBody3.set(newBody2)
            newBody3.set(screenshotArray, newBody2.length)
            body = newBody3
        } else {
            body = newBody2
        }
    }

    const options = {body}
    options.method = 'POST'
    try {
        const response = await fetch("https://o1160467.ingest.sentry.io/api/6244963/envelope/?sentry_key=a9f5f15340e847fa9f8af7120188faf3", options)
        const json = await response.json()
        if (!response.ok) {
            console.warn(getProjectPrefix(project, true), 'Ошибка отправки отчёта об ошибке', json)
        }
    } catch (error) {
        console.warn(getProjectPrefix(project, true), 'Ошибка отправки отчёта об ошибке', error)
    } finally {
        if (!reported) reported = {}
        reported[project.rating] = Date.now() + 86400000
        await db.put('other', reported, 'sentryReported')
    }
}

function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

// Sentry.addGlobalEventProcessor((event, hint) => {
//     if (tabDetails) {
//         hint.attachments = [{filename: "screenshot.png", data: tabDetails.screenshot}, {filename: "document.html", data: tabDetails.html}]
//         tabDetails = null
//     }
//     return event
// })
// Sentry.init({
//     dsn: "https://a9f5f15340e847fa9f8af7120188faf3@o1160467.ingest.sentry.io/6244963",
//     release: "Auto-Vote-Rating@" + chrome.runtime.getManifest().version,
//     tracesSampleRate: 0.0
// })
// Sentry.configureScope(scope => {
//     scope.setExtra('battery', 0.7);
// });
function convertBase64ToBlob(base64Image) {
    // Split into two parts
    const parts = base64Image.split(';base64,');

    // Hold the content type
    const imageType = parts[0].split(':')[1];

    // Decode Base64 string
    const decodedData = self.atob(parts[1]);

    // Create UNIT8ARRAY of size same as row data length
    const uInt8Array = new Uint8Array(decodedData.length);

    // Insert all character code into uInt8Array
    for (let i = 0; i < decodedData.length; ++i) {
        uInt8Array[i] = decodedData.charCodeAt(i);
    }

    // Return BLOB image after conversion
    return new Blob([uInt8Array], { type: imageType });
}

//Отправитель уведомлений
function sendNotification(title, message, notificationId) {
    if (!message) message = ''
    let notification = {
        type: 'basic',
        iconUrl: 'images/icon128.png',
        title: title,
        message: message
    }
    if (!notificationId) notificationId = ''
    chrome.notifications.create(notificationId, notification, function() {})
}
chrome.notifications.onClicked.addListener(async function (notificationId) {
    if (notificationId.startsWith('openTab_')) {
        try {
            const tabId = Number(notificationId.replace('openTab_', ''))
            if (!tabId) return
            const tab = await chrome.tabs.update(tabId, {active: true})
            if (!tab) return
            await chrome.windows.update(tab.windowId, {focused: true})
        } catch (error) {
            if (!error.message.includes('No tab with id')) {
                console.warn('Ошибка при фокусировке на вкладку', error)
            }
        }
    } else if (notificationId.startsWith('openProject_')) {
        try {
            const projectKey = Number(notificationId.replace('openProject_', ''))
            const found = await db.count('projects', projectKey)
            if (!found) return
            await chrome.runtime.openOptionsPage()
            // Дикий костыль на ожидание загрузки вкладки, мы не можем адекватно передать в настройки нужные данные, поэтому придётся так костылять
            const tab = await chrome.tabs.query({active: true, lastFocusedWindow: true})
            if (!tab.length) return
            if (tab[0].status !== 'complete') {
                for (let i = 0; i < 9; i++) {
                    await wait(250)
                    const t = await chrome.tabs.get(tab[0].id)
                    if (t.status === 'complete') break
                }
            }
            await chrome.runtime.sendMessage({openProject: projectKey})
        } catch (error) {
            console.warn('Ошибка открытия настроек с определённым проектом', error)
        }
    }
})

function getProjectPrefix(project, detailed) {
    if (detailed) {
        return '[' + allProjects[project.rating]?.URL() + '] ' + (project.nick != null && project.nick !== '' ? project.nick + ' – ' : '') + (project.game != null ? project.game + ' – ' : '') + project.id + (project.name != null ? ' – ' + project.name : '') + ' '
    } else {
        return '[' + allProjects[project.rating]?.URL() + '] ' + (project.nick != null && project.nick !== '' ? project.nick + ' ' : '') + (project.name != null ? '– ' + project.name : '– ' + project.id)
    }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateValue(objStore, value) {
    const found = await db.count(objStore, value.key)
    if (found) {
        await db.put(objStore, value, value.key)
        try {
            await chrome.runtime.sendMessage({updateValue: objStore, value})
        } catch (error) {
            if (!error.message.includes('Could not establish connection. Receiving end does not exist') && !error.message.includes('The message port closed before a response was received')) {
                console.error(error)
            }
        }
    } else {
        console.warn('The ' + objStore + ' could not be found, it may have been deleted', JSON.stringify(value))
    }
}

chrome.runtime.onInstalled.addListener(async function(details) {
    await waitInitialize()
    if (details.reason === 'install') {
        await chrome.runtime.openOptionsPage()
        chrome.runtime.sendMessage({installed: true})
    } else if (details.reason === 'update') {
        checkVote()
    }/* else if (details.reason === 'update' && details.previousVersion && (new Version(details.previousVersion)).compareTo(new Version('6.0.0')) === -1) {

    }*/
})

// function Version(s){
//   this.arr = s.split('.').map(Number)
// }
// Version.prototype.compareTo = function(v){
//     for (let i=0; ;i++) {
//         if (i>=v.arr.length) return i>=this.arr.length ? 0 : 1
//         if (i>=this.arr.length) return -1
//         const diff = this.arr[i]-v.arr[i]
//         if (diff) return diff>0 ? 1 : -1
//     }
// }


/* Store the original log functions. */
console._log = console.log
console._info = console.info
console._warn = console.warn
console._error = console.error
console._debug = console.debug

/* Redirect all calls to the collector. */
console.log = function () { return console._intercept('log', arguments) }
console.info = function () { return console._intercept('info', arguments) }
console.warn = function () { return console._intercept('warn', arguments) }
console.error = function () { return console._intercept('error', arguments) }
console.debug = function () { return console._intercept('debug', arguments) }

/* Give the developer the ability to intercept the message before letting
   console-history access it. */
console._intercept = function (type, args) {
    // Your own code can go here, but the preferred method is to override this
    // function in your own script, and add the line below to the end or
    // begin of your own 'console._intercept' function.
    // REMEMBER: Use only underscore console commands inside _intercept!
    console._collect(type, args)
}

console._collect = function (type, args) {
    const time = new Date().toLocaleString().replace(',', '')

    if (!type) type = 'log'

    if (!args || args.length === 0) return

    console['_' + type].apply(console, args)

    let log = '[' + time + ' ' + type.toUpperCase() + ']:'

    for (let arg of args) {
        if (typeof arg != 'string') arg = JSON.stringify(arg)
        log += ' ' + arg
    }

    if (dbLogs) dbLogs.add('logs', log)
}

/*
Открытый репозиторий:
https://github.com/Serega007RU/Auto-Vote-Rating/
*/