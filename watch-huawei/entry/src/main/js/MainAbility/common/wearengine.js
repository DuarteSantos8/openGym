/*
 * Copyright (c) 2021 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * Version: lite wearable 5.0.2.306
 * Description: wearEngine SDK
 */

import wearengine from "@system.wearengine";

// Trimmed to what openGym calls (Huawei's file send, ping, PeerDeviceClient and payload helpers are gone; the error
// handling of the calls kept is theirs). The text message path, the registration and the version checks are unchanged.
var V302 = 302;
var V303 = 303;
var V401 = 401;
var SDK_VERSION = "3";
var DEFAULT_EMPTY_FINGERPRINT = " ";
var SEND_FAIL = 206;
var SEND_SUCCESS = 207;

function isEmpty(parameter) {
  return parameter == "undefined" || parameter == null || parameter == "" || parameter == " ";
}

var P2pClient = (function() {
  function P2pClient() {
    var jsSdk = this;
    try {
      wearengine.getWearEngineVersion({
        complete: function(data) {
          if (data) {
            var versionArray = data.split(".");
            jsSdk.version = versionArray[versionArray.length - 1];
          } else {
            jsSdk.version = 0;
          }
        },
        sdkVersion: SDK_VERSION
      });
    } catch (error) {
      jsSdk.version = 0;
    }
  }
  // Set the package name of the phone app
  P2pClient.prototype.setPeerPkgName = function(peerPkgName) {
    this.peerPkgName = peerPkgName;
    if (this.version < V303) {
      return;
    }
    wearengine.setPackageName({ appName: peerPkgName, complete: function() {}, fail: function() {} });
  };
  // Set the app fingerprint information on the phone
  P2pClient.prototype.setPeerFingerPrint = function(fingerPrint) {
    if (this.version < V302) {
      return { data: "ERROR_CODE_VERSION_TOO_LOW", code: 208 };
    }
    if (isEmpty(fingerPrint)) {
      fingerPrint = DEFAULT_EMPTY_FINGERPRINT;
    }
    this.peerFingerPrint = fingerPrint;
    wearengine.setFingerprint({ appName: this.peerPkgName, appCert: fingerPrint, complete: function() {}, fail: function() {} });
  };
  // Register the message listener: receiver has onSuccess(), onFailure(), onReceiveMessage(message)
  P2pClient.prototype.registerReceiver = function(receiver) {
    if (!receiver) {
      return;
    }
    if (this.version > V302) {
      if (isEmpty(this.peerPkgName)) {
        receiver.onFailure();
        return;
      }
      wearengine.setPackageName({ appName: this.peerPkgName, complete: function() {}, fail: function() {} });
    }
    if (isEmpty(this.peerFingerPrint)) {
      receiver.onFailure();
      return;
    }
    var successCallBack = function(data) {
      if (data && !data.isRegister) {
        receiver.onReceiveMessage(data.message);
      } else {
        receiver.onSuccess();
      }
    };
    if (this.version >= V401) {
      wearengine.unsubscribeMsg();
      wearengine.subscribeMsg({ success: successCallBack, fail: receiver.onFailure });
    } else {
      FeatureAbility.subscribeMsg({ success: successCallBack, fail: receiver.onFailure });
    }
  };
  // Send a text message: sendCallback has onSuccess(), onFailure(), onSendResult(code), onSendProgress(count)
  P2pClient.prototype.send = function(message, sendCallback) {
    if (!message || !sendCallback) {
      return;
    }
    if (isEmpty(this.peerPkgName) || isEmpty(this.peerFingerPrint)) {
      sendCallback.onFailure();
      sendCallback.onSendResult({ data: "peerPkgName or peerFingerPrint empty", code: SEND_FAIL });
      return;
    }
    var successCallBack = function() {
      sendCallback.onSuccess();
      sendCallback.onSendResult({ data: "ERROR_CODE_COMM_SUCCESS", code: SEND_SUCCESS });
      sendCallback.onSendProgress("100%");
    };
    var failCallBack = function(errorMessage) {
      sendCallback.onFailure();
      sendCallback.onSendResult({ data: errorMessage, code: SEND_FAIL });
      sendCallback.onSendProgress("0%");
    };
    var args = { deviceId: "remote", bundleName: this.peerPkgName, abilityName: "", message: message.getData(), success: successCallBack, fail: failCallBack };
    if (this.version >= V401) {
      wearengine.sendMsg(args);
    } else {
      FeatureAbility.sendMsg(args);
    }
  };
  // Deregister the message listener: receiver has onSuccess()
  P2pClient.prototype.unregisterReceiver = function(receiver) {
    if (this.version >= V401) {
      wearengine.unsubscribeMsg();
    } else {
      FeatureAbility.unsubscribeMsg();
    }
    receiver.onSuccess();
  };
  return P2pClient;
})();

var Builder = (function() {
  function Builder() {}
  Builder.prototype.setDescription = function(description) {
    this.messageInfo = description;
  };
  return Builder;
})();

var Message = (function() {
  function Message() {}
  Message.prototype.getData = function() {
    return this.builder.messageInfo;
  };
  return Message;
})();

export { P2pClient, Message, Builder };
