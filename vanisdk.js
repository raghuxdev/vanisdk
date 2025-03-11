


var ZSDKUtil = function (ZSDKUtil) {
    // eslint-disable-line
  
    var QueryParams = GetQueryParams();
  
    // Global Logger instance which will be acquired and shared by other modules.
    var GlobalLogger;
  
    // minimal Logging utility.
    function ZLogger() {}
    ZLogger.prototype.Info = function () {
      if (ZSDKUtil.isDevMode() || ZSDKUtil.isLogEnabled()) {
        // console.info.apply(console, arguments); // eslint-disable-line
      }
    };
    ZLogger.prototype.Error = console.error; // eslint-disable-line
    function getLogger() {
      if (!GlobalLogger || !(GlobalLogger instanceof ZLogger)) {
        GlobalLogger = new ZLogger(); // Logging instance for Core Framework
      }
      return GlobalLogger;
    }
    function GetQueryParams(URL) {
      // TODO: Handle hash case too.
      var qParams = {};
      var currentURL = URL || window.location.href;
      var splittedParams = currentURL.substr(currentURL.indexOf('?') + 1).split('&');
      splittedParams.forEach(function (ele) {
        var miniSplit = ele.split('=');
        qParams[miniSplit[0]] = miniSplit[1];
      });
  
      // decoding serviceOrigin URL
      if (qParams.hasOwnProperty('serviceOrigin')) {
        qParams.serviceOrigin = decodeURIComponent(qParams.serviceOrigin);
      }
      return qParams;
    }
    function isDevMode() {
      return QueryParams && QueryParams.isDevMode;
    }
    function isLogEnabled() {
      return QueryParams && QueryParams.isLogEnabled;
    }
    ZSDKUtil.GetQueryParams = GetQueryParams;
    ZSDKUtil.isDevMode = isDevMode;
    ZSDKUtil.isLogEnabled = isLogEnabled;
    ZSDKUtil.getLogger = getLogger;
    return ZSDKUtil;
  }(window.ZSDKUtil || {});
  var ZSDKMessageManager = function (ZSDKMessageManager) {
    // eslint-disable-line
  
    var rootInstance;
    var Logger = ZSDKUtil.getLogger();
    var promiseIDCtr = 100;
    var PromiseQueue = {}; // Queue holding all the GetRequest promises
  
    var AuthParentWindow, AuthParentOrigin;
    var qParams = ZSDKUtil.GetQueryParams();
    function Init(widgetInstance) {
      // Config is for future use
      rootInstance = widgetInstance;
      window.addEventListener('message', MessageHandler);
      window.addEventListener('unload', DERegisterApp);
    }
  
    // Authorization Check in SDK side.
    function isAuthorizedMessage(MEvent) {
      var incomingSource = MEvent.source;
      var incomingOrigin = MEvent.origin;
      if (rootInstance.isRegistered() && AuthParentWindow === incomingSource && AuthParentOrigin === incomingOrigin) {
        return true;
      }
      return new Error('Un-Authorized Message.'); //No I18N
    }
    function MessageHandler(MessageEvent) {
      /* Added for backward compatibility support */
      var data;
      try {
        data = typeof MessageEvent.data === 'string' ? JSON.parse(MessageEvent.data) : MessageEvent.data; //No I18N
      } catch (e) {
        data = MessageEvent.data;
      }
      var messageType = data.type;
      try {
        if (messageType === '__REGISTER__' || isAuthorizedMessage(MessageEvent)) {
          switch (messageType) {
            case '__REGISTER__':
              HandleRegister(MessageEvent, data);
              break;
            case '__EVENT_RESPONSE__':
              HandleEventResponse(MessageEvent, data);
              break;
            case '__RUNTIME_SANDBOX_EVENT__':
              HandleSanboxEvent(MessageEvent, data);
            default:
              HandleCustomEvent(MessageEvent, data);
              break;
          }
        }
      } catch (e) {
        // Logger.Error('[SDK.MessageHandler] => ', e.stack);
      }
    }

    function HandleSanboxEvent(MessageEvent, data) {

      const { eventName, data: eventData } = data;

      if (!EventTracker.track(eventName, 'SANDBOX')) {
        console.warn(`Event chain blocked: ${eventName}`);
        return;
    }
      if (window.VaniSDK && typeof window.VaniSDK._invokeEvents === 'function') {
          window.VaniSDK._invokeEvents(eventName, eventData);
      }

    }
    function HandleRegister(MessageEvent, payload) {
      AuthParentWindow = window.parent;
      AuthParentOrigin = qParams.serviceOrigin;
      rootInstance.key = payload.uniqueID;
      rootInstance.parentWindow = AuthParentWindow;
      rootInstance._isRegistered = true;
      var registerEventObj = {
        'type': '__REGISTER__',
        //No I18N
        'widgetOrigin': getCurrentURLPath(),
        //No I18N
        'uniqueID': rootInstance.key //No I18N
      };
      SendEvent(registerEventObj, rootInstance);
      var initData = payload.data;
      executeEventHandlers(rootInstance, 'Load', initData); //No I18N
    }
    function HandleCustomEvent(MessageEvent, data) {
      var widgetID = data.widgetID;
      var eventName = data.eventName;
      var responseArr;
      if (rootInstance.key === widgetID) {
        // Checking 'EMIT' type to prevent circular exec.
        responseArr = executeEventHandlers(rootInstance, eventName, data.data);
      } else {
        var childInstance = rootInstance._childWidgets[widgetID];
        if (childInstance) {
          responseArr = executeEventHandlers(childInstance, eventName, data.data);
        }
      }
      if (data.isPromise) {
        var obj = {};
        Promise.all(responseArr).then(function (res) {
          obj.response = res;
          obj.widgetID = widgetID;
          obj.sourceWidgetID = rootInstance.key;
          sendPromiseEvent(data, obj);
        }).catch(function (err) {
          obj.response = err;
          obj.widgetID = widgetID;
          obj.sourceWidgetID = rootInstance.key;
          sendPromiseEvent(data, obj);
        });
      }
    }
    function sendPromiseEvent(data, responseObj) {
      var eventObject = {
        'type': '__EVENT_RESPONSE__',
        //No I18N
        'widgetOrigin': getCurrentURLPath(),
        //No I18N
        'uniqueID': rootInstance.key,
        //No I18N
        'eventName': data.eventName,
        //No I18N
        'data': responseObj,
        //No I18N
        'promiseID': data.promiseID //No I18N
      };
      SendEvent(eventObject, rootInstance);
    }
    function getResponseObj(response) {
      response.then(function (_res) {
        return {
          isSuccess: true,
          response: _res
        };
      }).catch(function (err) {
        return {
          isSuccess: false,
          response: err
        };
      });
    }
    function executeEventHandlers(widgetInstance, eventName, data) {
      var handlersArray = widgetInstance.eventHandlers[eventName],
        responseArr = [];
      if (Array.isArray(handlersArray)) {
        for (var i = 0; i < handlersArray.length; i++) {
          var response, responseObj;
          try {
            response = handlersArray[i].call(widgetInstance, data);
            if (response instanceof Promise) {
              responseObj = getResponseObj(response);
            } else {
              responseObj = {
                isSuccess: true,
                response: response
              };
            }
          } catch (e) {
            responseObj = {
              isSuccess: false,
              response: e
            };
          }
          responseArr.push(responseObj);
        }
      }
      return responseArr;
    }
    function HandleEventResponse(MessageEvent, payload) {
      var promiseID = payload.promiseID;
      var response = payload.data;
      var isResolved = payload.isSuccess;
      if (PromiseQueue.hasOwnProperty(promiseID)) {
        if (isResolved) {
          PromiseQueue[promiseID].resolve(response);
        } else {
          PromiseQueue[promiseID].reject(response);
        }
        PromiseQueue[promiseID] = undefined; // eslint-disable-line
        delete PromiseQueue[promiseID];
      } else {
        var a = 1;
        // TODO: Handle if there is no promiseID present
      }
    }
  
    // Sends events to ZFramework. TODO: Add to queue if not yet 'registered'.
    function SendEvent(eventObject, instance) {
      var isPromiseEvent = eventObject.isPromise;
      var PromiseID;
      if (isPromiseEvent) {
        PromiseID = getNextPromiseID();
        eventObject.promiseID = PromiseID; // eslint-disable-line
      }
      if (instance) {
        eventObject.uniqueID = (instance.parentWidget || instance).key;
        eventObject.widgetID = instance.key;
      }
      eventObject.time = new Date().getTime();
      PostMessage(eventObject);
      if (isPromiseEvent) {
        return AddToPromiseQueue(PromiseID);
      }
    }
    function getNextPromiseID() {
      return 'Promise' + promiseIDCtr++; //No I18N
    }
    function AddToPromiseQueue(promiseID) {
      var promise = new Promise(function (resolve, reject) {
        // Adding the promise to queue.
        PromiseQueue[promiseID] = {
          resolve: resolve,
          reject: reject,
          time: new Date().getTime()
        };
      });
      return promise;
    }
    function DERegisterApp() {
      var deRegisterSDKClient = {
        type: '__DEREGISTER__',
        //No I18N
        uniqueID: rootInstance.key
      };
      PostMessage(deRegisterSDKClient);
    }
  
    // Helpers
    function PostMessage(data) {
      if (typeof(data) === 'object') {
        data.widgetOrigin = encodeURIComponent(getCurrentURLPath());
      }
      if (!AuthParentWindow) {
        throw new Error('Parentwindow reference not found.'); //No I18N
      }
      AuthParentWindow.postMessage(data, qParams.serviceOrigin);
    }
    function getCurrentURLPath() {
      return window.location.protocol + '//' + window.location.host + window.location.pathname;
    }
    ZSDKMessageManager.Init = Init;
    ZSDKMessageManager.SendEvent = SendEvent;
    return ZSDKMessageManager;
  }(window.ZSDKMessageManager || {});
  ;
  window.ZSDK = function () {
    // eslint-disable-line
  
    var rootInstance;
    var qParams = ZSDKUtil.GetQueryParams();
  
    /* New Code */
    function Widget(opts) {
      this.serviceOrigin = opts.serviceOrigin || qParams.serviceOrigin;
      this.parentWidget = opts.parentWidget;
      this.key = opts.key;
      this._isRegistered = false;
      this._childWidgets = {};
      this.eventHandlers = Object.create(null);
      this.meta;
    }
    Widget.prototype.on = function (eventName, fn) {
      if (typeof eventName !== 'string') {
        throw new Error('Invalid eventname parameter passed.');
      }
      if (typeof fn !== 'function') {
        throw new Error('Invalid function parameter passed.');
      }
      var handlersArray = this.eventHandlers[eventName];
      if (!Array.isArray(handlersArray)) {
        this.eventHandlers[eventName] = handlersArray = [];
      }
      handlersArray.push(fn);
      if (eventName === 'Load') {
        return;
      }
      ;
      var eventBindObj = {
        type: '__EVENT_BIND__',
        //No I18N
        eventName: eventName,
        count: handlersArray.length
      };
      if (this.parentWidget && !this.parentWidget.isRegistered() || !this.parentWidget && !this.isRegistered()) {
        (this.parentWidget || this).on('Load', function () {
          ZSDKMessageManager.SendEvent(eventBindObj, this);
        });
      } else {
        ZSDKMessageManager.SendEvent(eventBindObj, this);
      }x
    };
    Widget.prototype._sendEvent = function (eventName, data, isPromise) {
      var messageObj = {
        type: '__EVENT__',
        //No I18N
        eventName: eventName,
        data: data,
        isPromise: isPromise
      };
      return ZSDKMessageManager.SendEvent(messageObj, this);
    };
    Widget.prototype.emit = function (eventName, data) {
      // Emti event to handlers in this context itself.
  
      var messageObj = {
        type: '__EMIT__',
        //No I18N
        eventName: eventName,
        data: data
      };
      ZSDKMessageManager.SendEvent(messageObj, this);
    };
    Widget.prototype.isRegistered = function () {
      return this._isRegistered;
    };
    Widget.prototype.fetch = function (opts) {
      var messageObj = {
        eventName: '__HTTP__',
        //No I18N
        isPromise: true,
        options: opts
      };
      return ZSDKMessageManager.SendEvent(messageObj, this);
    };
    Widget.prototype.createInstance = function (opts) {
      var messageObj = {
        eventName: '__CREATE_INSTANCE__',
        //No I18N
        isPromise: true,
        options: opts
      };
      return ZSDKMessageManager.SendEvent(messageObj, this);
    };
    Widget.prototype.modal = function (opts) {
      if (_typeof(opts) === 'object') {
        opts.location = '__MODAL__';
      }
      return this.createInstance(opts);
    };
    Widget.prototype.getWidgets = function () {
      var messageObj = {
        eventName: '__WIDGETS_INFO__',
        //No I18N
        isPromise: true
      };
      return ZSDKMessageManager.SendEvent(messageObj, this);
    };
    Widget.prototype.getWidgetInstance = function (widgetID) {
      if (typeof widgetID !== 'string') {
        throw new Error('Invalid WidgetID passed');
      }
      if (this.parentWidget) {
        return this.parentWidget.getWidgetInstance(widgetID);
      }
      var widgetInstance = this._childWidgets[widgetID];
      if (!widgetInstance) {
        this._childWidgets[widgetID] = widgetInstance = new Widget({
          key: widgetID,
          parentWidget: this
        });
      }
      return widgetInstance;
    };
    Widget.prototype.sandboxEmit = function(eventName, data) {
      if (typeof eventName !== 'string') {
          throw new Error('Invalid eventName parameter passed to vaniSDK.emit(). Event name must be a string.');   }
      var messageObj = {
          type: '__RUNTIME_ADDON_EVENT__', 
          eventName: eventName,
          data: data
      };
      ZSDKMessageManager.SendEvent(messageObj, this);
  };
    Widget.prototype.getFileObject = function (file) {
      return new File([file.slice(0, file.size)], file.name, {
        type: file.type
      });
    };
    return {
      Init: function Init() {
        if (rootInstance) {
          return rootInstance;
        }
        ;
        rootInstance = new Widget({
          serviceOrigin: qParams.serviceOrigin
        });
        ZSDKMessageManager.Init(rootInstance);
        return rootInstance;
      },
      _getRootInstance: function _getRootInstance() {
        return rootInstance;
      }
    };


  }();


  window.VaniSDK=function(window) {
 
    function emit(event,data) { 
        window.currentInstance.sandboxEmit(event,data);
    }

    const eventListeners = {};

    function on(eventName, callback) {
        if (!eventListeners[eventName]) {
            eventListeners[eventName] = [];
        }
        eventListeners[eventName].push(callback);
    }

    function _invokeEvents(eventName, data) {
        if (eventListeners[eventName]) {
            eventListeners[eventName].forEach(callback => callback(data));
        }
    }

  (function(window){
    window.currentInstance=this.ZSDK?.Init();
    console.log("initialized currentInstance")
  })(window)
  

const VaniSDK = {
    emit,
    on,
    _invokeEvents
  };
window.VaniSDK = VaniSDK;
 return VaniSDK;
}(window);


const EventTracker = {
  chainLimit: 5, // Max allowed chain depth
  timeWindow: 2000, // Time window in ms
  chains: new Map(), // Track event chains
  
  track(eventName, type) {
      const now = Date.now();
      const chainKey = `${eventName}_${type}`;
      
      if (!this.chains.has(chainKey)) {
          this.chains.set(chainKey, {
              count: 1,
              timestamp: now,
              lastType: type
          });
          return true;
      }

      const chain = this.chains.get(chainKey);
      
      // Reset if outside time window
      if (now - chain.timestamp > this.timeWindow) {
          chain.count = 1;
          chain.timestamp = now;
          chain.lastType = type;
          return true;
      }

      // Check for circular pattern
      if (chain.lastType === type) {
          chain.count++;
          if (chain.count > this.chainLimit) {
              console.warn(`Event chain limit reached for ${eventName}`);
              return false;
          }
      }

      chain.lastType = type;
      return true;
  }
};



  