import { Button } from '../../../../components/Form'

type TOAuthSigninProps = {
  signinOAuth(): Promise<void>
}

const OAuthSignin = (props: TOAuthSigninProps) => {
  const { signinOAuth } = props

  return (
    <div className="container pb-8">
      <div
        className="border border-gray-e6edff rounded-3xl overflow-hidden
                    py-14 lg:py-28 px-6 lg:px-12"
      >
        <h1 className="text-3xl lg:text-6xl font-semibold text-center">
          Git Open Source Hodler
        </h1>

        <div
          className="mt-7 text-lg lg:text-xl text-gray-53596d lg:leading-8
                        max-w-[39.75rem] mx-auto text-center"
        >
          Decentralized Git-on-chain DAO platform, and the fastest, most scalable, and
          free to use Ethereum Layer 2 blockchain
        </div>

        <div className="mt-16 lg:mt-20 text-gray-53596d max-w-[39.75rem] mx-auto text-center">
          GOSH guarantees the decentralization and security of your code, and offers easy
          Ethereum ecosystem integration for your project
        </div>

        <div className="mt-10 text-center">
          <Button type="button" size="xl" onClick={signinOAuth}>
            Sign in with Github
          </Button>
        </div>
      </div>
    </div>
  )
}

export { OAuthSignin }
