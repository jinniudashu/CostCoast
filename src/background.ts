import { ChromeRuntimeMessage } from './types/base';
import { firebaseConfig } from "./plugins/firebase_config";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw"; // note: we MUST use the sw version of the messaging API and NOT the one from "firebase/messaging"
import { getToken } from "firebase/messaging";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { DocumentReference, DocumentData } from 'firebase/firestore';
import { initializeApp } from "firebase/app";
import { Receipt, UserProfile } from "./types";

declare const self: any;

const firebase = initializeApp(firebaseConfig);
const db = getFirestore(firebase);

// 监听扩展安装事件
chrome.runtime.onInstalled.addListener(async () => {
    // 获取用户身份, 获取FCM registration token
    chrome.identity.getProfileUserInfo(async userInfo => {
        console.log('userInfo:', userInfo);
        // 获取FCM registration token
        const token = await getToken(getMessaging(), {
            serviceWorkerRegistration: self.registration, // note: we use the sw of ourself to register with
          });    
          console.log('token:', token);
        // 保存用户身份信息
        const userDocRef = doc(db, "Users", userInfo.id);
        // 保存到"Users/{id}"    
        await setDoc(userDocRef, {
            email: userInfo.email, 
            id: userInfo.id,
            timestamp: Date.now(),
            fcmToken: token,
            fcmTokenTimestamp: Date.now(),
            notify: true,
        });
    });

    chrome.contextMenus.create({
      id: "trackPriceChange",
      title: "跟踪价格变动",
      contexts: ["page"],
      type: "normal" // "normal", "checkbox", "radio", "separator"
    }, () => {
      console.log('跟踪价格变动 菜单创建成功！');
    });
});

// 监听右键菜单被点击事件
chrome.contextMenus.onClicked.addListener(function(menuInfo, tabInfo) {
    // 菜单信息，页面信息
    // console.log("menuInfo:", JSON.stringify(menuInfo))
    // console.log("tabInfo:", JSON.stringify(tabInfo))

    if (menuInfo.menuItemId === "trackPriceChange" && tabInfo && tabInfo.id) {
        chrome.tabs.sendMessage(tabInfo.id, {action: "extract"}, async(response) => {
            if (response && response.content) {
                const content: {memberId: string | null, receipt: Receipt} = response.content;
                console.log('response.content:', content);
                // 获取用户身份信息, 处理用户数据
                chrome.identity.getProfileUserInfo(async userInfo => {
                    console.log('userInfo:', userInfo);
                    // 用userInfo.id获取userProfile
                    const userProfileDoc = await getDoc(doc(db, "Users", userInfo.id));
                    if (userProfileDoc.exists()) {
                        const userProfile = userProfileDoc.data() as UserProfile;
                        console.log("userProfile data:", userProfile);
                        // 处理用户数据
                        await manageUserData(content, userProfile);
                    } else {
                        console.log("No such document!");
                    }
                  
                    // 发送桌面通知
                    chrome.notifications.create(
                        {
                            type: 'basic',
                            iconUrl: 'images/icon.png',
                            title: '收到收据信息',
                            message: '成功上传'+ content.receipt.receiptItems.length +'个项目'
                        }, 
                        (notificationId) => {console.log('已发送通知：', notificationId);}
                    );                
                
                });

            } else {
                console.log("未找到<tbody></tbody>标记。");
            }
        });
    }
});

// 从内容端接收事件
chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    // Issue Token
    if (request.type == ChromeRuntimeMessage.ISSUE_AUTH_TOKEN){
      console.log(request)
      sendAuthTokenToContent(request, sender, sendResponse)
      return true;
    }

    // Revole Token
    if (request.type == ChromeRuntimeMessage.REVOKE_AUTH_TOKEN){
      chrome.identity.removeCachedAuthToken({token: request.token}, () => {});
      chrome.identity.clearAllCachedAuthTokens(() => {});
      const url = `https://accounts.google.com/o/oauth2/revoke?token=${request.token}`
      fetch(url).then((response) => {});
      return true;
    }

    sendResponse();
    return
  }
);

async function sendAuthTokenToContent(request, sender, sendResponse) {
  chrome.identity.getAuthToken(
    {interactive: request.interactive},
    (token: string|undefined) => {
      sendResponse({token: token});  
    }
  )
}

// 管理用户数据
async function manageUserData(content: {memberId: string | null, receipt: Receipt}, userProfile: UserProfile) {
    // 维护userProfile
    console.log('更新用户Profile数据:', userProfile.id)

    const memberId = String(content.memberId)
    // 向用户profile数据中添加memberId
    userProfile.memberId = memberId;

    // 维护FCM-Token，检查是否需要更新
    const now = new Date().getTime();
    if (now - Number(userProfile.fcmTokenTimestamp) > 30 * 24 * 60 * 60 * 1000) {
        userProfile.fcmToken = await getToken(getMessaging(), {
            serviceWorkerRegistration: self.registration, // note: we use the sw of ourself to register with
        });
        userProfile.fcmTokenTimestamp = now;
    }

    // 更新userProfile
    const userInfoDocRef = doc(db, 'Users', userProfile.id);
    await setDoc(userInfoDocRef, userProfile);

    // 保存收据数据
    console.log('保存收据数据:', content.receipt)
    const memberDocRef = doc(db, 'Members', memberId);
    await saveReceiptData(memberDocRef, content.receipt);
    // 保存FCM-Token到文档"Members/{memberId}/profile/fcmToken"
    const fcmTokenDocRef = doc(collection(memberDocRef, 'profile'), 'fcmToken')
    await setDoc(fcmTokenDocRef, {fcmToken: userProfile.fcmToken, fcmTokenTimestamp: userProfile.fcmTokenTimestamp})

}

// 保存收据数据到文档"Memebers/{memberId}/receipts/{receiptId}"
async function saveReceiptData(memberDocRef: DocumentReference<DocumentData>, receipt: Receipt) {
    const receiptId = String(receipt.receiptId);
    const receiptDocRef = doc(collection(memberDocRef, 'receipts'), receiptId);
    
    // 添加收据数据到文档
    await setDoc(receiptDocRef, {
        tradeDatetime: receipt.tradeDatetime,
        items: receipt.receiptItems,
    }).then(() => {
        console.log("Member's receipt added successfully!");
        })
    .catch((error) => {
        console.error('Error adding receipt:', error);
    });
}

// 接收FCM消息
onBackgroundMessage(getMessaging(firebase), async (payload) => {
    console.log(`Huzzah! A Message.`, payload);
    // Note: you will need to open a notification here or the browser will do it for you.. something, something, security
    const notification: chrome.notifications.NotificationOptions = {
        type: 'basic',
        iconUrl: 'images/icon.png',
        title: payload.notification?.title,
        message: payload.notification?.body,
    }
    // sendNotification(notification)
  });
