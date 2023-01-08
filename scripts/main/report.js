chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.generateReport) {
        generateReport(request, sender, sendResponse)
        return true
    }
})

async function generateReport(request, sender, sendResponse) {
    const filter = (node) => {
        if (node && node.tagName) {
            return !node.tagName.toLowerCase().includes('img') && !node.tagName.toLowerCase().includes('video');
        }
        return true
    }
    let screenshot
    let screenshotError
    try {
        screenshot = await htmlToImage.toPng(document.body, {filter})
    } catch (error) {
        if (error?.target?.outerHTML) {
            screenshotError = error.target.outerHTML
        } else {
            screenshotError = error.toString()
        }
    }
    let html = document.body.outerHTML
    sendResponse({screenshot, screenshotError, html})
}