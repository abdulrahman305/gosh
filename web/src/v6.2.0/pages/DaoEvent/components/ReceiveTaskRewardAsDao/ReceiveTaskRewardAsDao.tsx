type TReceiveTaskRewardAsDaoProps = {
  data: {
    taskname: string
    reponame: string
    dao_name: string
  }
}

const ReceiveTaskRewardAsDao = (props: TReceiveTaskRewardAsDaoProps) => {
  const { data } = props

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-6">
        <div className="basis-5/12 xl:basis-2/12 text-xs text-gray-53596d">
          External DAO
        </div>
        <div className="text-sm">{data.dao_name}</div>
      </div>
      <div className="flex items-center gap-6">
        <div className="basis-5/12 xl:basis-2/12 text-xs text-gray-53596d">
          Repository
        </div>
        <div className="text-sm">{data.reponame}</div>
      </div>
      <div className="flex items-center gap-6">
        <div className="basis-5/12 xl:basis-2/12 text-xs text-gray-53596d">
          Task name
        </div>
        <div className="text-sm">{data.taskname}</div>
      </div>
    </div>
  )
}

export { ReceiveTaskRewardAsDao }
