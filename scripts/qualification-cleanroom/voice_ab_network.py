"""Additive task-owned Linux network isolation; never changes a default route."""
import json
import os
import pathlib
import subprocess

NAME='voice-ab-20261018'
INTERFACE='vab181h'
PEER='vab181n'
SUBNET='10.254.231.0/30'
ADDRESS='10.254.231.2'
ROOT=pathlib.Path.home() / 'xcsh-uat-lab/voice-ab-20261018'


def run(*args):
    return subprocess.check_output(args,text=True).strip()


def setup():
    os.umask(0o077)
    receipt=ROOT/'network.private.json'
    if receipt.exists():
        state=json.loads(receipt.read_text())
        assert NAME in run('ip','netns','list') and state['namespace']==NAME
        return state
    assert run('sysctl','-n','net.ipv4.ip_forward')=='1', 'requires existing IP forwarding; do not change host sysctl'
    assert NAME not in run('ip','netns','list')
    routes=json.loads(run('ip','-j','route','show','default'))
    interface=min(routes,key=lambda r:r.get('metric',0))['dev']
    assert not json.loads(run('ip','-j','route','show',SUBNET)), 'diagnostic subnet already assigned'
    dns=run('resolvectl','dns',interface).split(':',1)[-1].split()
    dns=[x for x in dns if x.count('.')==3 and not x.startswith('127.')]
    assert dns, 'no observed LAN DNS; do not invent resolver'
    run('sudo','-n','ip','netns','add',NAME)
    run('sudo','-n','ip','link','add',INTERFACE,'type','veth','peer','name',PEER)
    run('sudo','-n','ip','link','set',PEER,'netns',NAME)
    run('sudo','-n','ip','addr','add','10.254.231.1/30','dev',INTERFACE)
    run('sudo','-n','ip','link','set',INTERFACE,'up')
    run('sudo','-n','ip','netns','exec',NAME,'ip','addr','add',ADDRESS+'/30','dev',PEER)
    run('sudo','-n','ip','netns','exec',NAME,'ip','link','set',PEER,'up')
    run('sudo','-n','ip','netns','exec',NAME,'ip','link','set','lo','up')
    run('sudo','-n','ethtool','-K',INTERFACE,'gro','off','gso','off','tso','off')
    run('sudo','-n','ip','netns','exec',NAME,'ethtool','-K',PEER,'gro','off','gso','off','tso','off')
    run('sudo','-n','ip','netns','exec',NAME,'ip','route','add','default','via','10.254.231.1')
    run('sudo','-n','ip','netns','exec',NAME,'sysctl','-w','net.ipv6.conf.all.disable_ipv6=1')
    nat=['POSTROUTING','-s',SUBNET,'-o',interface,'-m','comment','--comment',NAME,'-j','MASQUERADE']
    run('sudo','-n','iptables','-t','nat','-A',*nat)
    run('sudo','-n','mkdir','-p','/etc/netns/'+NAME)
    subprocess.run(['sudo','-n','tee','/etc/netns/'+NAME+'/resolv.conf'],
                   input=''.join('nameserver '+x+'\n' for x in dns),text=True,stdout=subprocess.DEVNULL,check=True)
    state=dict(namespace=NAME,interface=INTERFACE,address=ADDRESS,subnet=SUBNET,
               uplink=interface,dns=dns,natRule=nat,originalDefaultRoutes=routes,ownedInterfaceOffloadsDisabled=True)
    assert json.loads(run('ip','-j','route','show','default'))==routes
    receipt.write_text(json.dumps(state,indent=2)+'\n')
    launcher=ROOT/'namespace-launch.py'
    launcher.write_text('import os,json,pathlib,sys\np=pathlib.Path(sys.argv[1]);s=json.loads(p.read_text());p.unlink();os.chdir(s["cwd"]);os.execve(s["command"][0],s["command"],s["environment"])\n')
    return state


def launch(command,environment,directory):
    import uuid
    for key in ('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'):
        environment.pop(key,None)
    path=directory/('launch-'+uuid.uuid4().hex+'.private.json')
    path.write_text(json.dumps(dict(command=command,environment=environment,cwd=str(directory/'project'))))
    return ['sudo','-n','ip','netns','exec',NAME,'setpriv','--reuid='+str(os.getuid()),
            '--regid='+str(os.getgid()),'--init-groups','/usr/bin/python3',str(ROOT/'namespace-launch.py'),str(path)]


def cleanup():
    receipt=ROOT/'network.private.json'
    state=json.loads(receipt.read_text())
    assert not run('sudo','-n','ip','netns','pids',NAME), 'owned diagnostic processes still active'
    run('sudo','-n','iptables','-t','nat','-D',*state['natRule'])
    run('sudo','-n','ip','link','del',INTERFACE)
    run('sudo','-n','ip','netns','del',NAME)
    run('sudo','-n','rm','/etc/netns/'+NAME+'/resolv.conf')
    run('sudo','-n','rmdir','/etc/netns/'+NAME)
    state['removed']=True
    state['defaultRoutesUnchanged']=json.loads(run('ip','-j','route','show','default'))==state['originalDefaultRoutes']
    (ROOT/'network-cleanup.private.json').write_text(json.dumps(state,indent=2)+'\n')
    print(json.dumps(dict(removed=True,defaultRoutesUnchanged=state['defaultRoutesUnchanged'])))


if __name__=='__main__': print(json.dumps(setup()))
