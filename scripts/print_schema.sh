#!/bin/bash

# Script to print the schema of all tables/indexes in the database
wrangler d1 execute infocal-db --command "
SELECT name, tbl_name, sql FROM sqlite_master;"