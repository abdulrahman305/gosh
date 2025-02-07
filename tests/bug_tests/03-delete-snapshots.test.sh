#!/bin/bash
set -e
set -o pipefail
. ./util.sh
set -x

# another variation of the test 21

NOW=$(date +%s)
REPO_NAME="repo21_$NOW"
BRANCH=dev
FILE=last

[ -d $REPO_NAME ] && rm -rf $REPO_NAME
[ -d $REPO_NAME"-clone" ] && rm -rf $REPO_NAME"-clone"

deploy_repo
REPO_ADDR=$(tonos-cli -j run $SYSTEM_CONTRACT_ADDR getAddrRepository "{\"name\":\"$REPO_NAME\",\"dao\":\"$DAO_NAME\"}" --abi $SYSTEM_CONTRACT_ABI | sed -n '/value0/ p' | cut -d'"' -f 4)

echo "***** awaiting repo deploy *****"
wait_account_active $REPO_ADDR

echo "***** cloning repo *****"
git clone gosh://$SYSTEM_CONTRACT_ADDR/$DAO_NAME/$REPO_NAME

#check
cd $REPO_NAME
# config git client
git config user.email "foo@bar.com"
git config user.name "My name"
git branch -m main

echo "main[1]: $(date +%s)" > $FILE
git add $FILE
git commit -m "created '$FILE'"

echo "main[2]: $(date +%s)" > $FILE
git add $FILE
git commit -m "updated '$FILE'"

echo "main[3]: $(date +%s)" > $FILE
git add $FILE
git commit -m "updated '$FILE'"

git push -u origin main

git checkout -b $BRANCH
echo "$BRANCH: $(date +%s)" > dev-$FILE
git add dev-$FILE
git commit -m "$BRANCH: update 'dev-$FILE'"
git push -u origin $BRANCH &> trace.log

status=`get_snapshot_status $REPO_ADDR $BRANCH dev-$FILE`
if [ "$status" != "Active" ]; then
    echo "FAILED: snapshot doesn't exists"
fi

git push origin :$BRANCH
git checkout main
git branch -D $BRANCH

git checkout -b $BRANCH
echo "$BRANCH: $(date +%s)" > dev-$FILE
git add dev-$FILE
git commit -m "$BRANCH: update 2 'dev-$FILE'"
GOSH_TRACE=5 git push -u origin $BRANCH &> trace.log
grep "push_new_branch_snapshot: deleting snapshot: branch_name=" trace.log

git checkout main
git merge $BRANCH
GOSH_TRACE=5 git push -u origin main &> trace-merge.log

cd ..
GOSH_TRACE=5 git clone gosh://$SYSTEM_CONTRACT_ADDR/$DAO_NAME/$REPO_NAME $REPO_NAME"-clone" &> "clone-${REPO_NAME}.log"

echo "TEST SUCCEEDED"

