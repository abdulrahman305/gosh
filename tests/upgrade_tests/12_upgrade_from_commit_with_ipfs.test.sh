#!/bin/bash
set -e 
set -o pipefail
. ./util.sh

set -x

# Test 12.
# This test checks that commit with ipfs data can be successfully upgraded.
# 1. Deploy repo
# 2. Create a binary file, commit it and push
# 3. Upgrade the repo
# 4. Push and commit changes to the binary file
# 5. Clone the repo
# 6. Check binary file state

if [ "$1" = "ignore" ]; then
  echo "Test $0 ignored"
  exit 0
fi

REPO_NAME=upgrade_repo12
DAO_NAME="dao-upgrade-test12_$(date +%s)"
NEW_REPO_PATH=upgrade_repo12_v2

# delete folders
[ -d $REPO_NAME ] && rm -rf $REPO_NAME
[ -d $NEW_REPO_PATH ] && rm -rf $NEW_REPO_PATH

# deploy new DAO that will be upgraded
deploy_DAO_and_repo

export OLD_LINK="gosh://$SYSTEM_CONTRACT_ADDR/$DAO_NAME/$REPO_NAME"
echo "OLD_LINK=$OLD_LINK"

echo "***** cloning old version repo *****"
git clone $OLD_LINK

# check
cd $REPO_NAME
git config user.email "foo@bar.com"
git config user.name "My name"
git branch -m main


# push 1 file
echo "***** Pushing file to old repo *****"
dd status=none if=/dev/urandom of=file.bin bs=1 count=65536
INIT_SHA=$(md5sum file.bin | cut -d ' ' -f 1)
echo $INIT_SHA

echo 2222 > 1.txt

git add file.bin 1.txt
git commit -m test
git push -u origin main

wait_set_commit $REPO_ADDR main

cd ..

echo "Upgrade DAO"
upgrade_DAO

echo "***** new repo02 deploy *****"
tonos-cli call --abi $WALLET_ABI_1 --sign $WALLET_KEYS $WALLET_ADDR AloneDeployRepository \
    "{\"nameRepo\":\"$REPO_NAME\",\"descr\":\"\",\"previous\":{\"addr\":\"$REPO_ADDR\", \"version\":\"$CUR_VERSION\"}}" || exit 1
REPO_ADDR=$(tonos-cli -j run $SYSTEM_CONTRACT_ADDR_1 getAddrRepository "{\"name\":\"$REPO_NAME\",\"dao\":\"$DAO_NAME\"}" --abi $SYSTEM_CONTRACT_ABI_1 | sed -n '/value0/ p' | cut -d'"' -f 4)
echo "REPO_ADDR=$REPO_ADDR"

echo "***** awaiting repo deploy *****"
wait_account_active $REPO_ADDR
sleep 3

export NEW_LINK="gosh://$SYSTEM_CONTRACT_ADDR_1/$DAO_NAME/$REPO_NAME"
echo "NEW_LINK=$NEW_LINK"

cd $REPO_NAME

echo old_ver > 1.txt
dd status=none if=/dev/urandom of=file.bin bs=1 count=65536
INIT_SHA=$(md5sum file.bin | cut -d ' ' -f 1)
echo $INIT_SHA
git add 1.txt file.bin
git commit -m test2
git push -u origin main

cd ..

sleep 30

echo "***** cloning repo with new link *****"
git clone $NEW_LINK $NEW_REPO_PATH

echo "***** push to new version *****"
cd $NEW_REPO_PATH
git config user.email "foo@bar.com"
git config user.name "My name"
git branch -m main

cur_ver=$(cat 1.txt)
if [ $cur_ver != "old_ver" ]; then
  echo "WRONG VERSION"
  exit 1
fi
echo "GOOD VERSION"

SHA=$(md5sum file.bin | cut -d ' ' -f 1)
echo $SHA $INIT_SHA

if [ "$SHA" != "$INIT_SHA" ]; then
  echo "Wrong file hash"
  exit 1
fi

echo "TEST SUCCEEDED"
