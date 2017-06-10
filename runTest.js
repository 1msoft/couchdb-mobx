import couchdb from './lib'


class TestDoc extends couchdb.Model {
    get defaultDocumentType() {
        return 'Test'
    }
}

let server = new couchdb.Server('http://127.0.0.1:5984/')
server.login('test', '1234')
    .then(() => {
        let db = server.openDatabase('tests')
        let ds = new couchdb.Store(db, 'test2')
        ds.createDocument({
            "trans_no": '223458',
            "trans_amount": 13460
        }).then(() => {
            ds.getDocument(ds.doc._id)
                .then(() => {
                    console.log(ds.doc)
                })
        })
    })