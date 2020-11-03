vote()
function vote() {
	chrome.storage.local.get('AVMRprojectsTopGames', function(result) {
		try {
			//Если идёт проверка CloudFlare
			if (document.querySelector("#cf-content > h1 > span") != null) {
				return
			}
			//Если мы находимся на странице проверки CloudFlare
			if (document.querySelector('span[data-translate="complete_sec_check"]') != null) {
				return
			}
			//Если успешное авто-голосование
			if (document.querySelector('div[class="alert alert-success"]') != null || document.querySelector('div[class="alert alert-success m-t-2"]') != null) {
				sendMessage('successfully')
				return
			}
			//Если есть предупреждение
			if (document.querySelector('div[class="alert alert-warning"]') != null) {
				//Если вы уже голосовали
				if (document.querySelector("#voteTimer") != null) {
                    let numbers = document.querySelector("#voteTimer").textContent.match(/\d+/g).map(Number)
					let count = 0;
					let hour = 0;
					let min = 0;
					let sec = 0;
					for (let i in numbers) {
						if (count == 0) {
							min = numbers[i]
						}
						count++
					}
					let milliseconds = (hour * 60 * 60 * 1000) + (min * 60 * 1000) + (sec * 1000)
					let later = Date.now() + milliseconds
					sendMessage('later ' + later)
					return
				} else {
					sendMessage(document.querySelector('div[class="alert alert-warning"]').innerText)
					return
				}
			}
			//Если есть ошибка
            if (document.querySelector('div[class="alert alert-danger"]') != null) {
            	sendMessage(document.querySelector('div[class="alert alert-danger"]').innerText)
            	return
            } else if (document.querySelector('div[class="alert alert-danger m-t-2"]') != null) {
            	sendMessage(document.querySelector('div[class="alert alert-danger m-t-2"]').innerText)
            	return
            }

            if (document.querySelector("#playername") != null) {
				let nick = getNickName(result.AVMRprojectsTopGames)
				if (nick == null) return;
				document.querySelector("#playername").value = nick;
            }
            
            let check = setInterval(function() {
            	if (document.querySelector("#captcha-content > div > div.grecaptcha-logo > iframe") != null) {//Ждёт загрузки reCaptcha
            		document.querySelector('button[type="submit"').click()
            		clearInterval(check);
            	}
            }, 1000);
		} catch (e) {
			if (document.URL.startsWith('chrome-error') || document.querySelector("#error-information-popup-content > div.error-code") != null) {
				sendMessage('Ошибка! Похоже браузер не может связаться с сайтом, вот что известно: ' + document.querySelector("#error-information-popup-content > div.error-code").textContent)
			} else {
				sendMessage('Ошибка! Кажется какой-то нужный элемент (кнопка или поле ввода) отсутствует. Вот что известно: ' + e.name + ": " + e.message + "\n" + e.stack);
			}
		}
	});
}

function getNickName(projects) {
    for (project of projects) {
        if (project.TopGames && document.URL.includes(project.game) && document.URL.includes(project.id)) {
            return project.nick
        }
    }
    
    sendMessage('Непредвиденная ошибка, не удалось найти никнейм, сообщите об этом разработчику расширения URL: ' + document.URL)
}

function sendMessage(message) {
    chrome.runtime.sendMessage({
         message: message
    }, function(response) {})
}