// @ts-check
import { computed, observable, toJS, action, extendObservable } from 'mobx'
import ajaxCore from 'pouchdb-ajax'
import PouchDB from 'pouchdb'
import PouchFind from 'pouchdb-find'
PouchDB.plugin(PouchFind)


function ajax(opts) {
    return new Promise(function (resolve, reject) {
        ajaxCore(opts, function (err, res) {
            /* istanbul ignore if */
            if (err) {
                return reject(err);
            }
            resolve(res);
        })
    })
}

function getUser(username) {
    let opts = {
        method: 'GET',
        url: `${this.baseUrl}_users/${encodeURIComponent('org.couchdb.user:' + username)}`,
        headers: { 'Content-Type': 'application/json' },
        body: ''
    }
    return ajax(opts)
}
function putUser(user) {
    let opts = {
        method: 'PUT',
        url: `${this.baseUrl}_users/${encodeURIComponent(user._id)}`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
    }
    return ajax(opts)
}

function genDocumentId(prefix) {
    return `${prefix}-${new Date().getTime()}`
}

/**
 * @param {PouchDB.Database} db 
 * @param {Object} selector
 * @param {Object} options
 */
function doMongoQuery(db, selector, options) {
    return db.find(selector, options)
}
/**
 * 
 * @param {PouchDB.Database} db 
 * @param {string} view 
 * @param {Object} options 
 */
function doMapReduceQuery(db, view, options) {
    return db.query(view, options)
}

/**
 * 
 * @param {PouchDB.Database} db 
 * @param {Array} range 
 * @param {Object} options 
 */
function getAllDocs(db, range, options) {
    let opts = {
        startkey: range[0],
        endkey: range[1]
    }
    Object.assign(opts, options)
    return db.allDocs(opts)
}

/**
 * 
 * @param {PouchDB.Database} db 
 * @param {number} since 
 * @param {Object} options 
 */
function getChangedDocs(db, since = 0, options = {}) {
    let opts = Object.assign(
        { since },
        options
    )
    return db.changes(opts)
}


class Server {
    /**
     * @param {string} baseUrl 
     * @param {string} [username] 
     * @param {string} [password]
     * @param {Object} [options]
     */
    constructor(baseUrl, options = {}) {
        let lastChar = baseUrl.slice(-1)
        this.baseUrl = lastChar === '/' ? baseUrl : baseUrl + '/'
        this.options = options
        this.session = observable.map({})
    }
    @computed get isLogin() {
        return this.session.has('userCtx')
    }


    /**
     * 登录
     * session + cookie
     * @param {string} username 
     * @param {string} password 
     */
    login(username, password) {
        if (!username || !password)
            this.handleError('login', new Error('用户名，密码不能为空！'))
        // post username password to _session
        let opts = {
            method: 'POST',
            url: `${this.baseUrl}_session`,
            headers: { 'Content-Type': 'application/json' },
            body: {
                name: username,
                password
            }
        }
        return ajax(opts).then(data => {
            // get _session document
            opts.method = 'GET'
            delete opts.body
            return ajax(opts)
        }).then(data => {
            this.session.replace(data)
            return data
        }).catch(err => {
            console.log(err)
            return {}
        })
    }

    /**
     * 登出
     */
    logout() {
        // delete _session
        let opts = {
            method: 'DELETE',
            url: `${this.baseUrl}_session`,
            headers: { 'Content-Type': 'application/json' }
        }
        return ajax(opts).then(data => {
            this.session.clear()
        })
    }

    /**
     * 创建用户
     * @param {string} username 
     * @param {string} password 
     * @param {array} roles 
     * @param {Object} profile 
     */
    createUser(username, password, roles = [], profile = {}) {
        if (!username || !password)
            this.handleError('createUser', new Error('用户名，密码不能为空！'))
        let user = {
            _id: 'org.couchdb.user:' + username,
            type: 'user',
            name: username,
            password,
            roles,
            profile
        }
        return putUser(user)
    }
    /**
     * 修改密码
     * admin or self
     * @param {string} newPassword 
     */
    changePassword(newPassword) {
        if (!newPassword)
            this.handleError('changePassword', new Error('密码不能为空！'))
        if (!this.session.has('userCtx'))
            this.handleError('changePassword', new Error('登录后才能修改密码！'))
        let username = this.session.userCtx.name

        return getUser(username)
            .then(user => {
                user.password = newPassword
                return putUser(user)
            })
    }
    /**
     * 修改用户数据
     * admin or self
     * @param {Object} profile 
     */
    changeProfile(profile = {}) {
        if (!this.session.has('userCtx'))
            this.handleError('changePassword', new Error('登录后才能修改用户数据！'))
        let username = this.session.userCtx.name
        return getUser(username)
            .then(user => {
                user.profile = profile
                return putUser(user)
            })
    }

    handleError(title, err) {
        console.log(title, err)
        throw err
    }
    /**
     * 打开数据库
     * 创建PouchDB对象
     * @param {string} name - database name without url
     */
    openDatabase(name) {
        return new PouchDB(`${this.baseUrl}${name}`, { skip_setup: true })
    }
}


/**
 * CouchDB-mobx connect
 * 
 */
class Store {
    // 查询结果
    /** @type {observable.array} */
    @observable queryset = []
    // 异步action或批量更新observable时设为true，防抖
    @observable isLoading = false
    // 分页参数
    @observable pagination = {
        startKey: '',
        size: 30,
        current: 0,
        count: 1
    }

    // 选中的行，用于多选
    @observable selectRows = []
    /** @type {observable.box | observable.map} */
    // 当前文档对象
    @observable doc = null
    /**
     * 构造函数
     * @param {Object} db - PouchDB 实例
     * @param {string | Object} model - 模型或文档类型docType
     * @param {Object} [meta] - 元数据
     */
    constructor(db, model, meta = null) {
        if (!db) this.handleError('database', new Error('No PouchDB instance!'))
        this.db = db
        this.meta = meta
        // docType
        if (typeof (model) === 'string') {
            //let type = model
            // no model class
            this.model_cls = null
            this.docType = model
        }
        else {
            this.model_cls = model
            this.docType = this.model_cls.docType
        }
    }


    /**
     * 根据查询条件参数的类型，选择mapreduce, alldocs，changes 或者mongo query api
     * 查询结果写入queryset
     * @param {string | array | number | Object} req - viewname, range, since or selector
     * @param {Object} options - 选项
     */
    getQueryset(req, options) {
        this.isLoading = true
        this.handleQueryRequest(req, options)
            .then(action(rows => {
                // set queryset
                this.queryset.clear()
                if (Array.isArray(rows)) {
                    rows.map(row => this.queryset.push(row))
                }
                this.isLoading = false
            }))
            .catch(err => { this.handleError('database', err) })
    }
    /**
     * 根据req类型确定查询方法，返回promise
     * @param {*} req 
     * @param {Object} options
     */
    handleQueryRequest(req, options) {
        const reqTypes = {
            'string': doMapReduceQuery,
            'array': getAllDocs,
            'number': getChangedDocs,
            'object': doMongoQuery
        }
        let qt = typeof (req)
        if (Reflect.has(reqTypes, qt))
            return reqTypes[qt](this.db, req, options)
        else if (Array.isArray(req))
            return getAllDocs(this.db, req, options)
        else if (typeof (req) === 'function')
            return req(this.db, options)
        else
            return Promise.reject(new Error('No Query Backend for req!'))
    }



    /**
     * 读取文档写入this.doc
     * @param {string} id - 文档编号
     * @param {string} rev - 版本，缺省为空，读取最新版本
     */
    getDocument(id, rev = null) {
        let options = rev ? { rev } : {}
        return this.db.get(id, options)
            .then(action(doc => {
                let cls = this.model_cls ? this.model_cls : Model
                this.doc = new cls(this, doc)
            }))
            .catch(err => this.handleError('database', err))
    }
    /**
     * 创建文档
     * @param {Object} [doc]
     */
    createDocument(doc) {
        if (!doc) this.handleError('database', new Error('不存在文档对象!'))
        if (!doc.type)
            doc.type = this.docType
        let cls = this.model_cls ? this.model_cls : Model
        let docObj = new cls(this, doc)
        return docObj.save()
            .then(action(() => this.doc = docObj))
            .catch(err => this.handleError('database', err))
    }
    /**
     * 更新文档
     * @param {Object} [doc]
     * @param {string} doc._id
     * @param {string} doc._rev
     */
    updateDocument(doc) {
        if (!doc) this.handleError('database', new Error('不存在文档对象!'))
        let updateDoc = this.doc ? toJS(this.doc) : {}

        Object.assign(updateDoc, doc)

        if (!updateDoc._id || !updateDoc._rev)
            this.handleError('updateDocument', new Error('文档格式不合法，缺少_rev或_id属性！'))
        let cls = this.model_cls ? this.model_cls : Model
        let docObj = new cls(this, updateDoc)
        return docObj.save()
            .then(action(() => this.doc = docObj))
            .catch(err => this.handleError('database', err))
    }
    /**
     * 删除文档
     * @param {Object} doc
     * @param {string} doc._id
     * @param {string} doc._rev
     */
    deleteDocument(doc) {
        if (!doc || !doc._id || !doc._rev)
            this.handleError('database', new Error('update a document need _id and _rev properties!'))

        return this.db.remove(doc._id, doc._rev)
            .then(action(() => {
                this.doc = null
            }))
            .catch(err => this.handleError('database', err))
    }

    selectRow(index) {
        this.selectRows.push(this.queryset[index])
    }

    unSelectRow(index) {
        if (index === 'undefined')
            this.selectRows.clear()
        else {
            let row = this.queryset[index]
            if (row) this.selectRows.remove(row)
        }
    }
    handleError(title, err) {
        console.log(title, err)
        throw err
    }
}

class Model {
    /**
     * 
     * @param {Store} store 
     * @param {Object} doc 
     * @param {Object} meta 
     */
    constructor(store, doc = null, meta = null) {
        if (!store && !store.db)
            throw new Error('store must be CouchDB Store!')

        // define non-enumerable property
        // store
        Reflect.defineProperty(this, 'store', {
            value: store,
            enumerable: false,
        })
        // meta
        Reflect.defineProperty(this, 'meta', {
            value: meta,
            enumerable: false,
        })
        // extendObservable document
        if (typeof (doc) === 'string') {
            // param as _id, so load from db.
            this.loadFromDB(doc)
        }
        else if (typeof (doc) === 'object') {
            extendObservable(this, doc)
        }
    }

    static get docType() {
        return 'JSON'
    }

    get db() {
        return this.store.db
    }

    loadFromDB(id) {
        this.db.get(id)
            .then(res => {
                extendObservable(this, res)
            })
            .catch(err => this.handleError(err))
    }
    // serialize object as json
    asJson() {
        return toJS(this)
    }


    perform_update(doc) {
        // hook for update 
    }
    validate(doc) {
        return true
    }
    // save to db
    save() {
        if (!this._id)
            this._id = this.generateId()
        if (!this.timestamp)
            this.timestamp = new Date().getTime()

        let doc = this.asJson()
        // hook update
        if (this.perform_update && typeof this.perform_update === 'function')
            this.perform_update(doc)
        if (this.validate(doc)) {
            return this.db.put(doc)
                .then(res => {
                    this._rev = res.rev
                })
                .catch(err => this.handleError(err))
        } else
            return Promise.reject(new Error('Validate Failure!'))
    }

    handleError(err) {
        throw err
    }

    generateId() {
        let docType = this.type ? this.type : Reflect.getPrototypeOf(this).constructor.docType
        return `${docType}-${new Date().getTime()}`
    }
}

export default {
    Server,
    Model,
    Store
}
