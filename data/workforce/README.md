# MAKE Network workforce data

`make-network-occupations.csv` lists 24 US occupations that are relevant to the DiscoverMake MAKE Network:
- shop operators (machinists, welders, sheet metal workers, woodworkers, painting and coating, assemblers, QA inspectors)
- designers and creators (industrial designers, drafters, mechanical engineers, craft artists, fashion designers)
- logistics and procurement (logisticians, purchasing agents, material movers)

**Source:** U.S. Bureau of Labor Statistics, *Occupational Outlook Handbook* (2024 employment, 2034 projections). BLS data is a U.S. government work and in the public domain. The rows were extracted from the dataset collected in `Greenmamba29/jobsdiscovermake`. That repo's code is a fork of `karpathy/jobs` with no license file, so **only the public-domain data was migrated. No code was copied.**

**Columns:** title, category, SOC code, median pay (annual and hourly), entry education, work experience, training, jobs in 2024, projected 2034 employment, outlook %, outlook description, employment change, BLS URL.

**Uses:**
- Shop-network recruitment: who runs lasers, brakes and finishing lines, and how many such workers exist.
- Labor-rate sanity checks for the shop rate cards in the quote engine (median hourly pay of machinists and welders).
- Campus Makers / workforce media content (workflow 07).
