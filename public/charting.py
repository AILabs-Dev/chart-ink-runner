import sys
import os
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

cur_dir = os.path.dirname(__file__)
new_dir = os.path.join(cur_dir, 'charts\\'+sys.argv[1])
if not os.path.isdir(new_dir):
    os.makedirs(new_dir)

df = pd.read_csv(sys.argv[1]+".csv", index_col=False, skiprows=1, names=['time', 'name', 'no', 'stock', 'price', 'quantity', 'type', 'sl', 'target', 'status', 'exitPrice', 'pl'])
df.head()


names = list(set(df['name']))
for name in names:
    d = df[df['name'] == name]
    d['cum'] = d['pl'].cumsum()
    plt.plot(d['time'], d['cum'])
    plt.savefig('charts\\'+sys.argv[1]+'\\'+name+".png")
    plt.cla()
df['cum'] = df['pl'].cumsum()
plt.savefig("charts\\" + sys.argv[1]+"\\overall.png")
plt.cla()
