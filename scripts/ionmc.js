window.onmessage = function(e) {
    if (e.data == 'vote') {
        vote(false)
    }
}
vote(true)

async function vote(first) {
    try {
        //Если пользователь не авторизован
        if (document.querySelector('div[class="notification is-primary text-center"]') != null) {
            chrome.runtime.sendMessage({message: document.querySelector('div[class="notification is-primary text-center"]').innerText})
            return
        }
        //Если есть ошибка
        if (document.querySelector('div[class="notification is-danger"]') != null) {
            //Если не удалось пройти капчу
            if (document.querySelector('div[class="notification is-danger"]').textContent != null) {
                chrome.runtime.sendMessage({message: document.querySelector('div[class="notification is-danger"]').textContent})
            }
            return
        }
        //Если успешное автоголосование
        if (document.querySelector('div[class="notification is-success has-text-centered"]') != null) {
            if (document.querySelector('div[class="notification is-success has-text-centered"]').textContent.includes('Голос засчитан')) {
                chrome.runtime.sendMessage({successfully: true})
            } else if (document.querySelector('div[class="notification is-success has-text-centered"]').textContent.includes('Вы уже голосовали')) {
                chrome.runtime.sendMessage({later: true})
            } else {
                chrome.runtime.sendMessage({message: document.querySelector('div[class="notification is-success has-text-centered"]').textContent})
            }
            return
        }
        if (first) {
            return
        }
        const nick = await getNickName()
        if (nick == null || nick == '')
            return
        document.querySelector('input[name=nickname]').value = nick
        document.querySelector('#app > div.mt-2.md\\:mt-0.wrapper.container.mx-auto > div.flex.items-start.mx-0.sm\\:mx-5 > div > div > form > div.flex.my-1 > div.w-2\\/5 > button').click()
    } catch (e) {
        chrome.runtime.sendMessage({message: 'Ошибка! Кажется какой-то нужный элемент (кнопка или поле ввода) отсутствует. Вот что известно: ' + e.name + ': ' + e.message + '\n' + e.stack})
    }
}

async function getNickName() {
    const projects = await new Promise(resolve=>{
        chrome.storage.local.get('AVMRprojectsIonMc', data=>{
            resolve(data['AVMRprojectsIonMc'])
        })
    })
    for (const project of projects) {
        if (project.IonMc && document.URL.startsWith('https://ionmc.top/projects/' + project.id)) {
            return project.nick
        }
    }
    if (!document.URL.startsWith('https://ionmc.top/vote/')) {
        chrome.runtime.sendMessage({message: 'Ошибка голосования! Произошло перенаправление/переадресация на неизвестный сайт: ' + document.URL + ' Проверьте данный URL'})
    } else {
        chrome.runtime.sendMessage({message: 'Непредвиденная ошибка, не удалось найти никнейм, сообщите об этом разработчику расширения URL: ' + document.URL})
    }
}
