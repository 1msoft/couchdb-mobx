import couchdb from '../lib'


describe("simple test", () => {

    it("login to couchdb", () => {
        let server = new couchdb.Server('http://127.0.0.1:5984/')
        expect.assertions(1)
        return server.login('test', '1234')
            .then((session) => expect(session.ok).toBe(true))
    })
    it("crud test", () => {
        let server = new couchdb.Server('http://127.0.0.1:5984/')
        let db = server.openDatabase('tests')
        let store = new couchdb.Store(db, 'test')
        let id = ''
        let rev = ''
        let promise = store.createDocument({
            "trans_no": '223458',
            "trans_amount": 13460
        }).then(() => {
            id = store.doc._id
            rev = store.doc._rev
        }).then(() => {
            return store.updateDocument({
                "_id": id,
                "_rev": rev,
                "trans_amount": 3333
            })
        })
        expect.assertions(1)
        promise.then(() => {

            expect(store.doc.trans_amount).toEqual(3333)
            console.log(store.doc)
        })
    })
})
