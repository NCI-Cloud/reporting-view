#!/usr/bin/env python

from flask import Flask, request, render_template

app = Flask(__name__)
app.debug = True

@app.route('/')
def login():
    print(request.form)
    token = ""
    if 'token' in request.form:
        token = request.form['token']
    return render_template('login.html', token=token)

@app.route('/<report>')
def report(report):
    report = '{}.html'.format(report)
    try:
        return render_template(report)
    except flask.templating.TemplateNotFound:
        abort(404)

@app.errorhandler(404)
def page_not_found(error):
    return render_template('404.html'), 404

if __name__ == '__main__':
    app.run()
