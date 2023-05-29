import { createApp } from "vue";
import App from "./App.vue";
import { createPinia } from "pinia";
import { Receipt, ReceiptItem } from "../types";

function requestPermission() {
    console.log('Requesting permission...');
    Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
            console.log('Notification permission granted.');
        } else {
            console.log('Notification permission denied.');
            // 处理用户拒绝通知权限的情况
            // const notifyDocRef = doc(collection(memberDocRef, 'Profile'), 'notify');
            // setDoc(notifyDocRef, {notify: false, timestamp: Date.now()})
        }
    });
}

window.onload = async () => {
  const el = document.querySelector('body');
  if (el) {
    el.insertAdjacentHTML(
      'afterend',
      '<div id="app">hello</div>',
    );
    const app = createApp(App).use(createPinia());
    app.mount('#app');
  }

  requestPermission();
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === "extract") {
        // 声明待上传数据对象，由member id和收据数组构成
        const content: {memberId: string | null, receipt: Receipt} = { memberId: null, receipt: {receiptId: null, receiptItems: [], tradeDatetime: null} };

        // 获取收据DOM
        const receiptDom = document.getElementById('dataToPrint');
        if (!receiptDom) {
            sendResponse({receipt: null});
            return;
        }

        // 获取memberId
        const header = receiptDom.querySelector('.tableHead th');
        if (!header || !header.textContent) {
            sendResponse({receipt: null});
            return;
        }
        const regex = /Member (\d+)/;
        const match = regex.exec(header.textContent.trim());
        if (match) {
            content.memberId = match[1];
        }
        
        // 获取receiptId
        const receiptBarcode = receiptDom.querySelector('.wrapper .MuiBox-root:last-child');
        if (!receiptBarcode) {
            sendResponse({receipt: null});
            return;
        }
        const receiptNumber = receiptBarcode.querySelector('.barcode .MuiBox-root:last-child');
        if (!receiptNumber) {
            sendResponse({receipt: null});
            return;
        }
        content.receipt.receiptId = receiptNumber.textContent;        

        // 获取收据数据并发送到background.js
        const tbody = document.querySelector("tbody");
        if (tbody) {
            // 提取交易日期和时间
            const dateDom = tbody.querySelector("span.date");
            const timeDom = tbody.querySelector("span.time");
            if (dateDom && timeDom) {
                content.receipt.tradeDatetime = dateDom.textContent + " " + timeDom.textContent;
            }
            // 提取收据项目
            const tableRows = Array.from(tbody.querySelectorAll('tr'));
            for (const row of tableRows) {
                const rowCells = row.querySelectorAll('td');
                if (rowCells[1].textContent === "SUBTOTAL") break

                const item: ReceiptItem = {
                    xLabel: rowCells[0].textContent, 
                    itemId: rowCells[1].textContent, 
                    name: rowCells[2].textContent, 
                    price: rowCells[3].textContent
                };
                content.receipt.receiptItems.push(item);
            }
            // 发送数据到background.js
            sendResponse({content: content});
            console.log('From content.js:', content);  
        } else {
            sendResponse({content: null});
        }
    }
});
