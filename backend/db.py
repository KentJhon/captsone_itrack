import mysql.connector

def get_db():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password="",   # set if you actually use one
        database="itrack",
    )
